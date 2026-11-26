import test from 'node:test'
import assert from 'node:assert/strict'
import { QuestionRepository } from '../src/questionRepository.js'
import {
  InterviewerService,
  buildInterviewerSystemPrompt,
  type InterviewerChatProvider,
} from '../src/interviewerService.js'
import { createApp } from '../../../apps/api/server/src/app.js'

test('buildInterviewerSystemPrompt grounds in accepted vs failing submissions without leaking hidden tests', () => {
  const repo = new QuestionRepository()
  const baseQuestion = {
    id: 'q-1',
    title: 'Two Sum',
    difficulty: 'easy' as const,
    topic: 'arrays',
    statement: 'Find two indices that sum to target.',
    constraints: ['2 <= N <= 10^4'],
    examples: [{ input: '2 7', output: '0 1' }],
    starterCode: { Python: 'pass', JavaScript: '', Java: '', 'C++': '', C: '' },
    testCases: [],
  }

  const acceptedPrompt = buildInterviewerSystemPrompt({
    question: baseQuestion,
    language: 'Python',
    code: 'def solve():\n    return [0, 1]',
    lastSubmission: {
      id: 'sub-1',
      questionId: 'q-1',
      language: 'Python',
      status: 'accepted',
      submitted: true,
      totalCases: 4,
      visiblePassed: 2,
      visibleTotal: 2,
      hiddenPassed: 2,
      hiddenTotal: 2,
      runtimeMs: 12,
      memoryMb: null,
      message: 'All passed',
    },
  })
  assert.match(acceptedPrompt, /ALL TESTS PASSED/i)
  assert.match(acceptedPrompt, /Big-O/i)

  const wrongPrompt = buildInterviewerSystemPrompt({
    question: baseQuestion,
    language: 'C',
    code: 'int main() { return 0; }',
    lastSubmission: {
      id: 'sub-2',
      questionId: 'q-1',
      language: 'C',
      status: 'wrong_answer',
      submitted: true,
      totalCases: 4,
      visiblePassed: 1,
      visibleTotal: 2,
      hiddenPassed: 0,
      hiddenTotal: 2,
      runtimeMs: 5,
      memoryMb: null,
      message: 'One or more test cases failed.',
    },
  })
  assert.match(wrongPrompt, /WRONG ANSWER/i)
  assert.match(wrongPrompt, /NEVER reveal hidden test inputs/i)
})

test('InterviewerService streams deltas from provider', async () => {
  const repo = new QuestionRepository()
  const provider: InterviewerChatProvider = {
    async *streamChat() {
      yield 'What is '
      yield 'the time complexity?'
    },
  }
  const service = new InterviewerService(repo, provider)

  const chunks: string[] = []
  for await (const delta of service.streamReply({
    questionId: 'curated-arrays-two-sum',
    language: 'Python',
    code: 'print(0, 1)',
    message: 'Review my code',
  })) {
    chunks.push(delta)
  }

  assert.equal(chunks.join(''), 'What is the time complexity?')
})

test('POST /api/interviewer/chat streams SSE delta and done events', async () => {
  const repo = new QuestionRepository()
  const provider: InterviewerChatProvider = {
    async *streamChat() {
      yield 'Hello '
      yield 'candidate!'
    },
  }
  const interviewerService = new InterviewerService(repo, provider)
  const app = createApp({ repository: repo, interviewerService })

  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', () => resolve()))
  const address = server.address() as { port: number }
  const baseUrl = `http://127.0.0.1:${address.port}`

  try {
    const res = await fetch(`${baseUrl}/api/interviewer/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        questionId: 'curated-arrays-two-sum',
        language: 'Python',
        code: 'print(0, 1)',
        message: 'Check my approach',
      }),
    })

    const text = await res.text()
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${text}`)
    assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/)
    assert.match(text, /"type":"delta","content":"Hello "/)
    assert.match(text, /"type":"delta","content":"candidate!"/)
    assert.match(text, /"type":"done"/)
  } finally {
    server.closeAllConnections?.()
    server.close()
  }
})

test('POST /api/interviewer/fix returns diagnosis, fixedCode, and explanation', async () => {
  const repo = new QuestionRepository()
  const provider: InterviewerChatProvider = {
    async *streamChat() {
      yield 'ok'
    },
    async fixCode() {
      return {
        diagnosis: 'Loop returned early on first mismatch.',
        fixedCode: 'print("0 1")',
        explanation: 'Use a hash map to find the complement in O(N).',
      }
    },
  }
  const interviewerService = new InterviewerService(repo, provider)
  const app = createApp({ repository: repo, interviewerService })

  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', () => resolve()))
  const address = server.address() as { port: number }
  const baseUrl = `http://127.0.0.1:${address.port}`

  try {
    const res = await fetch(`${baseUrl}/api/interviewer/fix`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        questionId: 'curated-arrays-two-sum',
        language: 'Python',
        code: 'print("bad")',
      }),
    })
    assert.equal(res.status, 200)
    const body = (await res.json()) as { diagnosis: string; fixedCode: string; explanation: string }
    assert.equal(body.fixedCode, 'print("0 1")')
    assert.match(body.diagnosis, /Loop/)
  } finally {
    server.closeAllConnections?.()
    server.close()
  }
})

