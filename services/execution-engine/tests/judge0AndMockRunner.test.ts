import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FallbackCodeRunner,
  JUDGE0_LANGUAGE_IDS,
  Judge0CodeRunner,
  fromBase64,
  toBase64,
} from '../src/judge0CodeRunner.js'
import { MockCodeRunner } from '../src/mockCodeRunner.js'
import { createCodeRunner } from '../src/runnerFactory.js'
import { DockerCodeRunner } from '../src/dockerCodeRunner.js'

test('Judge0CodeRunner maps all 5 languages including C', () => {
  assert.equal(JUDGE0_LANGUAGE_IDS.Python, 71)
  assert.equal(JUDGE0_LANGUAGE_IDS['C++'], 54)
  assert.equal(JUDGE0_LANGUAGE_IDS.C, 50)
  assert.equal(JUDGE0_LANGUAGE_IDS.Java, 62)
  assert.equal(JUDGE0_LANGUAGE_IDS.JavaScript, 63)
})

test('Judge0 base64 helpers round-trip UTF-8 content', () => {
  const original = '#include <stdio.h>\nint main() { printf("42\\n"); return 0; }'
  assert.equal(fromBase64(toBase64(original)), original)
})

test('Judge0CodeRunner submits, polls, and decodes accepted result', async () => {
  const calls: string[] = []
  const mockFetch: typeof fetch = async (input, init) => {
    const url = String(input)
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    if (url.endsWith('/submissions?base64_encoded=true&wait=false')) {
      return new Response(JSON.stringify({ token: 'tok-123' }), { status: 201 })
    }
    return new Response(JSON.stringify({
      token: 'tok-123',
      status_id: 3,
      status: { id: 3, description: 'Accepted' },
      stdout: toBase64('42\n'),
      stderr: null,
      time: '0.025',
    }), { status: 200 })
  }

  const runner = new Judge0CodeRunner({
    baseUrl: 'http://127.0.0.1:2358',
    pollIntervalMs: 1,
    fetchImpl: mockFetch,
  })

  const result = await runner.execute({
    language: 'C',
    code: '#include <stdio.h>\nint main() { printf("42\\n"); return 0; }',
    input: '',
    timeoutMs: 3000,
  })

  assert.equal(result.stdout, '42\n')
  assert.equal(result.stderr, '')
  assert.equal(result.timedOut, false)
  assert.equal(result.runtimeError, false)
  assert.equal(result.runtimeMs, 25)
  assert.equal(calls.length, 2)
})

test('Judge0CodeRunner handles compilation error (status 6) and TLE (status 5)', async () => {
  let statusId = 6
  const mockFetch: typeof fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/submissions?base64_encoded=true&wait=false')) {
      return new Response(JSON.stringify({ token: 'tok-err' }), { status: 201 })
    }
    return new Response(JSON.stringify({
      token: 'tok-err',
      status_id: statusId,
      compile_output: statusId === 6 ? toBase64('main.c:1:1: error: syntax error') : null,
      stdout: null,
      stderr: null,
      time: '1.000',
    }), { status: 200 })
  }

  const runner = new Judge0CodeRunner({ baseUrl: 'http://127.0.0.1:2358', pollIntervalMs: 1, fetchImpl: mockFetch })

  const compileErr = await runner.execute({ language: 'C', code: 'bad code', input: '', timeoutMs: 2000 })
  assert.equal(compileErr.runtimeError, true)
  assert.equal(compileErr.timedOut, false)
  assert.match(compileErr.stderr, /syntax error/)

  statusId = 5
  const tle = await runner.execute({ language: 'Python', code: 'while True: pass', input: '', timeoutMs: 2000 })
  assert.equal(tle.timedOut, true)
  assert.equal(tle.runtimeError, false)
  assert.match(tle.stderr, /Time Limit Exceeded/)
})

test('MockCodeRunner rejects empty/stub code and accepts implemented code', async () => {
  const runner = new MockCodeRunner({ simulatedRuntimeMs: 12 })

  const stubResult = await runner.execute({
    language: 'Python',
    code: 'def main():\n    pass\n\nmain()',
    input: '1 2',
    timeoutMs: 2000,
  })
  assert.equal(stubResult.runtimeError, true)
  assert.match(stubResult.stderr, /empty or incomplete/i)

  const okResult = await runner.execute({
    language: 'C',
    code: '#include <stdio.h>\nint main() { int a, b; scanf("%d %d", &a, &b); printf("%d\\n", a + b); return 0; }',
    input: '1 2',
    timeoutMs: 2000,
  })
  assert.equal(okResult.runtimeError, false)
  assert.equal(okResult.timedOut, false)
  assert.equal(okResult.runtimeMs, 12)
})

test('FallbackCodeRunner delegates to fallback when primary throws', async () => {
  const primary = new MockCodeRunner({
    handler: () => {
      throw new Error('Judge0 unreachable')
    },
  })
  const fallback = new MockCodeRunner({
    handler: () => ({ stdout: 'ok', stderr: '', timedOut: false, runtimeError: false, runtimeMs: 5 }),
  })

  const resilient = new FallbackCodeRunner(primary, fallback, true)
  const res = await resilient.execute({ language: 'Python', code: 'print("ok")', input: '', timeoutMs: 1000 })
  assert.equal(res.stdout, 'ok')

  const strict = new FallbackCodeRunner(primary, fallback, false)
  await assert.rejects(
    strict.execute({ language: 'Python', code: 'print("ok")', input: '', timeoutMs: 1000 }),
    /Judge0 unreachable/,
  )
})

test('createCodeRunner builds expected runner instances', () => {
  assert.ok(createCodeRunner({ mode: 'docker' }) instanceof DockerCodeRunner)
  assert.ok(createCodeRunner({ mode: 'mock' }) instanceof MockCodeRunner)
  assert.ok(createCodeRunner({ mode: 'judge0', allowDockerFallback: false }) instanceof Judge0CodeRunner)
  assert.ok(createCodeRunner({ mode: 'judge0', allowDockerFallback: true }) instanceof FallbackCodeRunner)
})

