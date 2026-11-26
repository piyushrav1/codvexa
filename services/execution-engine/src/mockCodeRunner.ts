import type { CodeRunner, ExecutionRequest, ExecutionResult } from './codeRunner.js'

export interface MockCodeRunnerOptions {
  /** Optional custom handler for deterministic test responses. */
  handler?: (request: ExecutionRequest) => ExecutionResult | Promise<ExecutionResult>
  /** Simulated runtime in ms when using the default stub evaluator. */
  simulatedRuntimeMs?: number
}

/**
 * Mock code runner for local development and unit tests without Docker or Judge0.
 * Mirrors the dev mock runner behavior from tmm-interview: rejects empty or
 * untouched starter stubs with a runtimeError, and simulates fast execution
 * when the candidate has written non-trivial solution code.
 */
export class MockCodeRunner implements CodeRunner {
  private readonly handler?: MockCodeRunnerOptions['handler']
  private readonly simulatedRuntimeMs: number

  constructor(options: MockCodeRunnerOptions = {}) {
    this.handler = options.handler
    this.simulatedRuntimeMs = options.simulatedRuntimeMs ?? 15
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    if (this.handler) {
      return this.handler(request)
    }

    const trimmed = request.code.trim()
    const isStarterOrEmpty =
      trimmed.length < 20 ||
      trimmed === 'def main():\n    pass\n\nmain()' ||
      (trimmed.includes('pass') && !trimmed.includes('return') && !trimmed.includes('print')) ||
      trimmed === '// Write your code here' ||
      trimmed === '# Write your code here'

    if (isStarterOrEmpty) {
      return {
        stdout: '',
        stderr: 'Mock runner: solution appears empty or incomplete.',
        timedOut: false,
        runtimeError: true,
        runtimeMs: this.simulatedRuntimeMs,
      }
    }

    return {
      stdout: '',
      stderr: '',
      timedOut: false,
      runtimeError: false,
      runtimeMs: this.simulatedRuntimeMs,
    }
  }
}

