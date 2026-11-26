import type { ProgrammingLanguage } from '../../../packages/shared/src/types.js'
import type { CodeRunner, ExecutionRequest, ExecutionResult } from './codeRunner.js'
import { DockerCodeRunner, appendOutputChunk } from './dockerCodeRunner.js'

export interface Judge0CodeRunnerOptions {
  baseUrl?: string | undefined
  apiKey?: string | undefined
  rapidApiHost?: string | undefined
  pollIntervalMs?: number | undefined
  maxPollMs?: number | undefined
  fetchImpl?: typeof fetch | undefined
}

interface Judge0SubmissionResponse {
  token?: string
}

interface Judge0SubmissionResult {
  token?: string
  status_id: number
  status?: { id: number; description: string }
  stdout?: string | null
  stderr?: string | null
  compile_output?: string | null
  time?: string | null
  memory?: number | null
}

export const JUDGE0_LANGUAGE_IDS: Record<ProgrammingLanguage, number> = {
  Python: 71,     // Python 3.8.1
  'C++': 54,      // C++ (GCC 9.2.0)
  C: 50,          // C (GCC 9.2.0)
  Java: 62,       // Java (OpenJDK 13.0.1)
  JavaScript: 63, // JavaScript (Node.js 12.14.0)
}

export function toBase64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64')
}

export function fromBase64(value: string | null | undefined): string {
  if (!value) return ''
  try {
    return Buffer.from(value.trim(), 'base64').toString('utf8')
  } catch {
    return value
  }
}

/**
 * Sandboxed code execution adapter communicating with Judge0 CE / RapidAPI.
 * Implements the single-execution CodeRunner contract used by SubmissionService.
 */
export class Judge0CodeRunner implements CodeRunner {
  private readonly baseUrl: string
  private readonly apiKey?: string
  private readonly rapidApiHost?: string
  private readonly pollIntervalMs: number
  private readonly maxPollMs: number
  private readonly fetchFn: typeof fetch

  constructor(options: Judge0CodeRunnerOptions = {}) {
    this.baseUrl = (options.baseUrl || 'https://ce.judge0.com').replace(/\/$/, '')
    this.apiKey = options.apiKey
    this.rapidApiHost = options.rapidApiHost
    this.pollIntervalMs = options.pollIntervalMs ?? 350
    this.maxPollMs = options.maxPollMs ?? 12_000
    this.fetchFn = options.fetchImpl ?? fetch
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }

    if (this.apiKey) {
      if (this.baseUrl.includes('rapidapi.com')) {
        headers['X-RapidAPI-Key'] = this.apiKey
        headers['X-RapidAPI-Host'] = this.rapidApiHost || new URL(this.baseUrl).host
      } else {
        headers['X-Auth-Token'] = this.apiKey
      }
    }

    return headers
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const languageId = JUDGE0_LANGUAGE_IDS[request.language] ?? 71
    const cpuLimit = Math.max(1, Math.ceil(request.timeoutMs / 1000))
    const startedAt = Date.now()
    const sourceCode =
      request.language === 'Python' && !request.code.includes('__future__')
        ? `from __future__ import annotations\n${request.code}`
        : request.code

    const submitRes = await this.fetchFn(`${this.baseUrl}/submissions?base64_encoded=true&wait=false`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        language_id: languageId,
        source_code: toBase64(sourceCode),
        stdin: toBase64(request.input),
        cpu_time_limit: cpuLimit,
        wall_time_limit: cpuLimit + 2,
      }),
      signal: AbortSignal.timeout(10_000),
    })

    if (!submitRes.ok) {
      const errText = await submitRes.text().catch(() => '')
      throw new Error(`Judge0 submission failed [${submitRes.status}]: ${errText}`)
    }

    const submitData = (await submitRes.json()) as Judge0SubmissionResponse
    if (!submitData.token) {
      throw new Error('Judge0 submission response missing token.')
    }

    const result = await this.pollSubmission(submitData.token)
    const runtimeMs = result.time
      ? Math.max(1, Math.round(parseFloat(result.time) * 1000))
      : Date.now() - startedAt

    if (result.status_id <= 2) {
      return {
        stdout: appendOutputChunk('', fromBase64(result.stdout)).output,
        stderr: result.status?.description || 'Judge0 execution timed out.',
        timedOut: true,
        runtimeError: false,
        runtimeMs,
      }
    }

    if (result.status_id === 6) {
      const compileOut = fromBase64(result.compile_output || result.stderr) || 'Compilation Error'
      if (this.isJavaVmThreadError(request.language, compileOut)) {
        return new DockerCodeRunner().execute(request)
      }
      return {
        stdout: '',
        stderr: appendOutputChunk('', compileOut).output,
        timedOut: false,
        runtimeError: true,
        runtimeMs,
      }
    }

    const stdout = appendOutputChunk('', fromBase64(result.stdout)).output
    const rawStderr = fromBase64(result.stderr)

    if (result.status_id === 5) {
      return {
        stdout,
        stderr: appendOutputChunk('', rawStderr || 'Time Limit Exceeded').output,
        timedOut: true,
        runtimeError: false,
        runtimeMs,
      }
    }

    if (result.status_id >= 7) {
      const combined = `${stdout}\n${rawStderr}`
      if (this.isJavaVmThreadError(request.language, combined)) {
        return new DockerCodeRunner().execute(request)
      }
      const errText = rawStderr || stdout || result.status?.description || 'Runtime Error'
      return {
        stdout,
        stderr: appendOutputChunk('', errText).output,
        timedOut: false,
        runtimeError: true,
        runtimeMs,
      }
    }

    return {
      stdout,
      stderr: appendOutputChunk('', rawStderr).output,
      timedOut: false,
      runtimeError: false,
      runtimeMs,
    }
  }

  private isJavaVmThreadError(language: ProgrammingLanguage, output: string): boolean {
    return (
      language === 'Java' &&
      (output.includes('pthread_create failed') || output.includes('unable to create native thread'))
    )
  }

  private async pollSubmission(token: string): Promise<Judge0SubmissionResult> {
    const pollUrl = `${this.baseUrl}/submissions/${encodeURIComponent(token)}?base64_encoded=true&fields=token,status_id,status,stdout,stderr,compile_output,time,memory`
    const deadline = Date.now() + this.maxPollMs

    while (Date.now() < deadline) {
      const res = await this.fetchFn(pollUrl, { headers: this.getHeaders(), signal: AbortSignal.timeout(10_000) })
      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        throw new Error(`Judge0 poll failed [${res.status}]: ${errText}`)
      }

      const data = (await res.json()) as Judge0SubmissionResult
      if (data.status_id > 2) {
        return data
      }

      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs))
    }

    const finalRes = await this.fetchFn(pollUrl, { headers: this.getHeaders() })
    if (!finalRes.ok) {
      return { status_id: 1, status: { id: 1, description: 'In Queue' } }
    }
    return (await finalRes.json()) as Judge0SubmissionResult
  }
}

/**
 * Resilient CodeRunner wrapper that delegates to a primary runner and
 * optionally falls back to a secondary runner if the primary throws.
 */
export class FallbackCodeRunner implements CodeRunner {
  constructor(
    private readonly primary: CodeRunner,
    private readonly fallback?: CodeRunner,
    private readonly allowFallback = true,
  ) {}

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    try {
      return await this.primary.execute(request)
    } catch (error) {
      if (!this.allowFallback || !this.fallback) {
        throw error
      }
      return this.fallback.execute(request)
    }
  }
}

