import type {
  AttemptDto,
  CodeFixRequest,
  CodeFixResponse,
  GenerateQuestionRequest,
  InterviewerChatRequest,
  PracticeTimerDto,
  QuestionDto,
  SubmissionRequest,
  SubmissionResultDto,
} from '../../../../packages/shared/src/types'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? ''

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string) {
    super(message)
    this.name = 'ApiError'
  }
}

function getSessionId(): string {
  try {
    let id = localStorage.getItem('testmeman.sessionId')
    if (!id) {
      id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 's-' + Math.random().toString(36).slice(2)
      localStorage.setItem('testmeman.sessionId', id)
    }
    return id
  } catch {
    return ''
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const sessionId = getSessionId()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(sessionId ? { 'x-session-id': sessionId } : {}),
    ...(init?.headers as Record<string, string> | undefined),
  }
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers,
  })
  const payload = await response.json().catch(() => null) as
    | T
    | { error?: { message?: string; code?: string } }
    | null

  if (!response.ok) {
    const errorPayload = payload as { error?: { message?: string; code?: string } } | null
    throw new ApiError(
      errorPayload?.error?.message ?? 'The request could not be completed.',
      response.status,
      errorPayload?.error?.code,
    )
  }
  return payload as T
}

export const apiClient = {
  health: () => request<{ status: string }>('/api/health'),
  getActiveAttempt: () => request<AttemptDto>('/api/attempts/active'),
  resumeActiveAttempt: () => request<AttemptDto | null>('/api/attempts/resume'),
  getAttemptTimer: (attemptId: string) => request<PracticeTimerDto>(`/api/attempts/${encodeURIComponent(attemptId)}/timer`),
  updateAttemptTimer: (attemptId: string, action: 'pause' | 'resume' | 'reset' | 'extend', seconds = 300) =>
    request<PracticeTimerDto>(`/api/attempts/${encodeURIComponent(attemptId)}/timer/${action}`, {
      method: 'POST',
      body: JSON.stringify({ seconds }),
    }),
  createNewAttempt: (input: GenerateQuestionRequest = {}) =>
    request<AttemptDto>('/api/attempts/new', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  saveAttemptDraft: (input: { attemptId: string; language: AttemptDto['language']; code: string; revision: number }) =>
    request<AttemptDto>('/api/attempts/draft', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  quitAttempt: (attemptId: string, input: { language: AttemptDto['language']; code: string; revision: number }) =>
    request<{ status: 'abandoned' }>(`/api/attempts/${encodeURIComponent(attemptId)}/quit`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  generateQuestion: (input: GenerateQuestionRequest = {}) =>
    request<QuestionDto>('/api/questions/generate', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  getQuestion: (id: string) => request<QuestionDto>(`/api/questions/${encodeURIComponent(id)}`),
  submit: (input: SubmissionRequest) =>
    request<SubmissionResultDto>('/api/submissions', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  getSubmissions: (questionId: string) =>
    request<SubmissionResultDto[]>(`/api/submissions?questionId=${encodeURIComponent(questionId)}`),
  getHint: (questionId: string) =>
    request<{ hint: string; level: number }>(`/api/questions/${encodeURIComponent(questionId)}/hints`, {
      method: 'POST',
    }),
  fixCode: (input: CodeFixRequest) =>
    request<CodeFixResponse>('/api/interviewer/fix', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  async streamInterviewerChat(
    input: InterviewerChatRequest,
    callbacks: {
      onDelta: (text: string) => void
      onError?: (message: string) => void
      onDone?: () => void
    },
    signal?: AbortSignal,
  ): Promise<void> {
    const sessionId = getSessionId()
    const response = await fetch(`${API_BASE_URL}/api/interviewer/chat`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(sessionId ? { 'x-session-id': sessionId } : {}),
      },
      body: JSON.stringify(input),
      signal,
    })

    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: { message?: string; code?: string } } | null
      throw new ApiError(
        payload?.error?.message ?? 'AI interviewer request failed.',
        response.status,
        payload?.error?.code,
      )
    }

    const reader = response.body?.getReader()
    if (!reader) {
      callbacks.onDone?.()
      return
    }

    const decoder = new TextDecoder()
    let buffer = ''

    const processEvent = (rawEvent: string) => {
      const dataLine = rawEvent
        .split('\n')
        .find((line) => line.startsWith('data: '))
      if (!dataLine) return
      try {
        const parsed = JSON.parse(dataLine.slice(6)) as { type: string; content?: string }
        if (parsed.type === 'delta' && parsed.content) {
          callbacks.onDelta(parsed.content)
        } else if (parsed.type === 'error') {
          callbacks.onError?.(parsed.content || 'Streaming error')
        } else if (parsed.type === 'done') {
          callbacks.onDone?.()
        }
      } catch {
        // ignore malformed SSE frame
      }
    }

    while (true) {
      const { value, done } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const events = buffer.split('\n\n')
      buffer = events.pop() ?? ''

      for (const rawEvent of events) {
        processEvent(rawEvent)
      }
    }

    if (buffer.trim()) {
      processEvent(buffer)
    }

    callbacks.onDone?.()
  },
}
