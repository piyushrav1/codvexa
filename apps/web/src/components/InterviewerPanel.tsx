import { useEffect, useRef, useState } from 'react'
import { Bot, Check, Send, Sparkles, Trash2, User, Wrench, X } from 'lucide-react'
import type {
  CodeFixResponse,
  InterviewerTurnDto,
  ProgrammingLanguage,
  QuestionDto,
  SubmissionResultDto,
} from '../../../../packages/shared/src/types'
import { apiClient } from '../services'

interface DiffLine {
  type: 'same' | 'add' | 'remove'
  text: string
}

/** Compute a simple line-by-line LCS diff for showing + added and - removed lines. */
function computeLineDiff(before: string, after: string): DiffLine[] {
  const a = before.replace(/\r\n/g, '\n').split('\n')
  const b = after.replace(/\r\n/g, '\n').split('\n')
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? 1 + dp[i + 1][j + 1] : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const diff: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      diff.push({ type: 'same', text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      diff.push({ type: 'remove', text: a[i] })
      i++
    } else {
      diff.push({ type: 'add', text: b[j] })
      j++
    }
  }
  while (i < m) diff.push({ type: 'remove', text: a[i++] })
  while (j < n) diff.push({ type: 'add', text: b[j++] })
  return diff
}

interface InterviewerPanelProps {
  question: QuestionDto
  language: ProgrammingLanguage
  code: string
  lastSubmission: SubmissionResultDto | null
  messages: InterviewerTurnDto[]
  setMessages: React.Dispatch<React.SetStateAction<InterviewerTurnDto[]>>
  onApplyCode: (fixedCode: string) => void
}

export function InterviewerPanel({
  question,
  language,
  code,
  lastSubmission,
  messages,
  setMessages,
  onApplyCode,
}: InterviewerPanelProps) {
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [fixing, setFixing] = useState(false)
  const [fixResult, setFixResult] = useState<(CodeFixResponse & { originalCode: string; applied?: boolean }) | null>(null)
  const [error, setError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streaming, fixResult])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const quickPrompts = lastSubmission
    ? lastSubmission.status === 'accepted'
      ? [
          'Analyze my time and space complexity',
          'How would this scale to 10^7 items?',
          'Are there any memory trade-offs?',
        ]
      : [
          'Why did my submission fail?',
          'Which edge cases should I check?',
          'Help me optimize without giving the answer',
        ]
    : [
        'Review my current approach',
        'Give me a Socratic hint',
        'Clarify the problem constraints',
      ]

  const handleFixCode = async () => {
    if (fixing || streaming) return
    setError('')
    setFixing(true)
    const snapshot = code
    try {
      const res = await apiClient.fixCode({
        questionId: question.id,
        language,
        code: snapshot,
        lastSubmission,
      })
      setFixResult({ ...res, originalCode: snapshot, applied: false })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to analyze and fix code.')
    } finally {
      setFixing(false)
    }
  }

  const sendMessage = async (textToSend: string) => {
    const trimmed = textToSend.trim()
    if (!trimmed || streaming) return

    setError('')
    setInput('')

    const candidateTurn: InterviewerTurnDto = {
      id: `cand-${Date.now()}`,
      role: 'candidate',
      text: trimmed,
      createdAt: new Date().toISOString(),
    }

    const assistantId = `int-${Date.now() + 1}`
    const assistantTurn: InterviewerTurnDto = {
      id: assistantId,
      role: 'interviewer',
      text: '',
      createdAt: new Date().toISOString(),
    }

    const historyForRequest = messages.map((m) => ({
      role: m.role,
      text: m.text,
    }))

    setMessages((prev) => [...prev, candidateTurn, assistantTurn])
    setStreaming(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      await apiClient.streamInterviewerChat(
        {
          questionId: question.id,
          language,
          code,
          message: trimmed,
          history: historyForRequest,
          lastSubmission,
        },
        {
          onDelta: (delta) => {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, text: m.text + delta } : m)),
            )
          },
          onError: (errMsg) => {
            setError(errMsg)
            setMessages((prev) => prev.filter((m) => m.id !== assistantId || m.text.length > 0))
          },
        },
        controller.signal,
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to reach AI interviewer.'
      setError(msg)
      setMessages((prev) => prev.filter((m) => m.id !== assistantId || m.text.length > 0))
    } finally {
      setMessages((prev) => prev.filter((m) => m.id !== assistantId || m.text.length > 0))
      setStreaming(false)
      abortRef.current = null
    }
  }

  const diffLines = fixResult ? computeLineDiff(fixResult.originalCode, fixResult.fixedCode) : []

  return (
    <div className="interviewer-panel">
      <div className="interviewer-header">
        <div className="interviewer-title">
          <Sparkles size={15} />
          <span>AI Technical Interviewer</span>
          {lastSubmission && (
            <span className={`interviewer-status-pill ${lastSubmission.status}`}>
              {lastSubmission.status.replace(/_/g, ' ')}
            </span>
          )}
        </div>
        <div className="interviewer-header-actions">
          <button
            type="button"
            className="interviewer-fix-btn"
            onClick={() => void handleFixCode()}
            disabled={fixing || streaming}
            title="Analyze and fix code from the editor"
          >
            <Wrench size={13} />
            {fixing ? 'Fixing...' : 'Fix My Code'}
          </button>
          {messages.length > 0 && (
            <button
              type="button"
              className="interviewer-clear-btn"
              onClick={() => setMessages([])}
              disabled={streaming}
              title="Clear conversation"
            >
              <Trash2 size={13} /> Clear
            </button>
          )}
        </div>
      </div>

      <div className="interviewer-messages">
        {fixResult && (
          <div className="interviewer-diff-card">
            <div className="diff-card-header">
              <strong>Code Diagnosis &amp; Fix</strong>
              <button
                type="button"
                className="diff-close-btn"
                onClick={() => setFixResult(null)}
                aria-label="Close code diff"
              >
                <X size={14} />
              </button>
            </div>
            <div className="diff-card-notes">
              <div><span className="diff-label bad">What&apos;s wrong:</span> {fixResult.diagnosis}</div>
              <div><span className="diff-label good">What&apos;s fixed:</span> {fixResult.explanation}</div>
            </div>
            <div className="diff-code-box" role="region" aria-label="Code diff">
              {diffLines.map((line, idx) => (
                <div key={idx} className={`diff-line ${line.type}`}>
                  <span className="diff-sign">
                    {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
                  </span>
                  <span className="diff-text">{line.text || ' '}</span>
                </div>
              ))}
            </div>
            <div className="diff-card-actions">
              <button
                type="button"
                className="diff-apply-btn"
                disabled={fixResult.applied}
                onClick={() => {
                  onApplyCode(fixResult.fixedCode)
                  setFixResult((prev) => (prev ? { ...prev, applied: true } : null))
                }}
              >
                <Check size={14} />
                {fixResult.applied ? 'Applied to Editor' : 'Apply Fix to Editor'}
              </button>
            </div>
          </div>
        )}

        {messages.length === 0 && !fixResult ? (
          <div className="interviewer-empty">
            <Bot size={26} />
            <h3>Socratic Interview &amp; Follow-Ups</h3>
            <p>
              Ask about your approach, edge cases, or Big-O complexity—or click{' '}
              <strong>Fix My Code</strong> to see what&apos;s wrong with a +/- diff.
            </p>
          </div>
        ) : (
          messages.map((turn) => (
            <div key={turn.id} className={`interviewer-turn ${turn.role}`}>
              <div className="interviewer-avatar">
                {turn.role === 'interviewer' ? <Bot size={14} /> : <User size={14} />}
              </div>
              <div className="interviewer-bubble">
                {turn.text || (streaming ? 'Thinking...' : '')}
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <div className="interviewer-error" role="alert">
          {error}
        </div>
      )}

      <div className="interviewer-chips">
        {quickPrompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            className="interviewer-chip"
            disabled={streaming}
            onClick={() => void sendMessage(prompt)}
          >
            {prompt}
          </button>
        ))}
      </div>

      <form
        className="interviewer-form"
        onSubmit={(e) => {
          e.preventDefault()
          void sendMessage(input)
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about complexity, edge cases, or your code..."
          disabled={streaming}
          aria-label="Message AI Interviewer"
        />
        <button type="submit" disabled={streaming || !input.trim()} aria-label="Send message">
          <Send size={15} />
        </button>
      </form>
    </div>
  )
}
