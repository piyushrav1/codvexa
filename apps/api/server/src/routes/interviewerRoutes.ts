import { Router } from 'express'
import { z } from 'zod'
import { PROGRAMMING_LANGUAGES } from '../../../../../packages/shared/src/types.js'
import { HttpError } from '../../../../../packages/shared/src/errors/httpError.js'
import { InterviewerService } from '../../../../../services/question-engine/src/interviewerService.js'
import { validateBody } from '../middleware/validateRequest.js'

const chatSchema = z.object({
  questionId: z.string().trim().min(1).max(100),
  language: z.enum(PROGRAMMING_LANGUAGES),
  code: z.string().max(100_000).default(''),
  message: z.string().trim().min(1).max(4000),
  history: z.array(z.object({
    role: z.enum(['interviewer', 'candidate']),
    text: z.string().max(10_000),
  })).max(30).default([]),
  lastSubmission: z.object({
    id: z.string(),
    questionId: z.string(),
    language: z.enum(PROGRAMMING_LANGUAGES),
    status: z.enum(['accepted', 'wrong_answer', 'runtime_error', 'time_limit_exceeded']),
    submitted: z.boolean(),
    totalCases: z.number(),
    visiblePassed: z.number(),
    visibleTotal: z.number(),
    hiddenPassed: z.number(),
    hiddenTotal: z.number(),
    runtimeMs: z.number().nullable(),
    memoryMb: z.number().nullable(),
    message: z.string(),
  }).passthrough().nullable().optional(),
})

const fixSchema = z.object({
  questionId: z.string().trim().min(1).max(100),
  language: z.enum(PROGRAMMING_LANGUAGES),
  code: z.string().max(100_000).default(''),
  lastSubmission: chatSchema.shape.lastSubmission,
})

export function createInterviewerRouter(service: InterviewerService): Router {
  const router = Router()

  router.post('/fix', validateBody(fixSchema), async (request, response, next) => {
    try {
      const result = await service.fixCode({
        questionId: request.body.questionId,
        language: request.body.language,
        code: request.body.code,
        lastSubmission: request.body.lastSubmission ?? null,
      })
      response.json(result)
    } catch (error) {
      next(error)
    }
  })

  router.post('/chat', validateBody(chatSchema), async (request, response, next) => {
    const abortController = new AbortController()
    response.on('close', () => {
      if (!response.writableEnded) {
        abortController.abort()
      }
    })

    let headersSent = false
    const sendEvent = (payload: { type: 'delta' | 'done' | 'error'; content: string }) => {
      if (!response.writableEnded) {
        response.write(`data: ${JSON.stringify(payload)}\n\n`)
      }
    }

    try {
      const stream = service.streamReply({
        questionId: request.body.questionId,
        language: request.body.language,
        code: request.body.code,
        message: request.body.message,
        history: request.body.history,
        lastSubmission: request.body.lastSubmission ?? null,
        signal: abortController.signal,
      })

      for await (const delta of stream) {
        if (!headersSent) {
          headersSent = true
          response.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
          response.setHeader('Cache-Control', 'no-cache, no-transform')
          response.setHeader('Connection', 'keep-alive')
          response.flushHeaders?.()
        }
        sendEvent({ type: 'delta', content: delta })
      }

      if (!headersSent) {
        headersSent = true
        response.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
        response.setHeader('Cache-Control', 'no-cache, no-transform')
        response.setHeader('Connection', 'keep-alive')
        response.flushHeaders?.()
      }

      sendEvent({ type: 'done', content: '' })
      response.end()
    } catch (error) {
      if (!headersSent) {
        next(error)
        return
      }
      const message = error instanceof HttpError || error instanceof Error
        ? error.message
        : 'AI interviewer stream failed.'
      sendEvent({ type: 'error', content: message })
      sendEvent({ type: 'done', content: '' })
      response.end()
    }
  })

  return router
}

