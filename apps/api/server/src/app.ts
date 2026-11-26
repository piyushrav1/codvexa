import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { pinoHttp } from 'pino-http'
import { env } from './config/env.js'
import { logger } from './config/logger.js'
import { errorHandler } from './middleware/errorHandler.js'
import { notFoundHandler } from './middleware/notFoundHandler.js'
import { QuestionRepository } from '../../../../services/question-engine/src/questionRepository.js'
import { createQuestionRouter } from './routes/questionRoutes.js'
import { healthRouter } from './routes/healthRoutes.js'
import { createRateLimiter } from './middleware/rateLimiter.js'
import { createSubmissionRouter } from './routes/submissionRoutes.js'
import { QuestionService } from '../../../../services/question-engine/src/questionService.js'
import { SubmissionService } from '../../../../services/execution-engine/src/submissionService.js'
import { GeminiQuestionProvider } from '../../../../services/question-engine/src/geminiProvider.js'
import { QuestionAuditor } from '../../../../services/question-engine/src/questionAuditor.js'
import {
  GeminiInterviewerProvider,
  InterviewerService,
} from '../../../../services/question-engine/src/interviewerService.js'
import { createCodeRunner } from '../../../../services/execution-engine/src/runnerFactory.js'
import type { CodeRunner } from '../../../../services/execution-engine/src/codeRunner.js'
import { createAttemptRouter } from './routes/attemptRoutes.js'
import { createInterviewerRouter } from './routes/interviewerRoutes.js'

export interface AppDependencies {
  repository?: QuestionRepository
  codeRunner?: CodeRunner
  questionService?: QuestionService
  submissionService?: SubmissionService
  interviewerService?: InterviewerService
}

export function createApp(dependencies: AppDependencies = {}) {
  const app = express()
  const repository = dependencies.repository ?? new QuestionRepository(env.MONGODB_URI, env.MONGODB_DB)
  const codeRunner = dependencies.codeRunner ?? createCodeRunner({
    mode: env.CODE_RUNNER,
    judge0Url: env.JUDGE0_URL,
    judge0Key: env.JUDGE0_KEY,
    judge0Host: env.JUDGE0_HOST,
    allowDockerFallback: env.ALLOW_DOCKER_FALLBACK === 'true',
  })
  const questionProvider = env.GEMINI_API_KEY
    ? new GeminiQuestionProvider(env.GEMINI_API_KEY, env.GEMINI_MODEL)
    : undefined
  const questionAuditor = env.GEMINI_API_KEY
    ? new QuestionAuditor(env.GEMINI_API_KEY, env.GEMINI_MODEL)
    : undefined
  const questionService = dependencies.questionService ?? new QuestionService(repository, questionProvider, questionAuditor, codeRunner)
  const submissionService = dependencies.submissionService ?? new SubmissionService(repository, codeRunner, env.EXECUTION_TIMEOUT_MS)
  const interviewerProvider = env.GEMINI_API_KEY
    ? new GeminiInterviewerProvider(env.GEMINI_API_KEY, env.GEMINI_MODEL)
    : undefined
  const interviewerService = dependencies.interviewerService ?? new InterviewerService(repository, interviewerProvider)

  const configuredOrigins = env.CLIENT_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
  const allowedOrigins = new Set([
    ...configuredOrigins,
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4173',
    'http://127.0.0.1:4173',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ])

  app.disable('x-powered-by')
  app.use(helmet())
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.has(origin)) {
          return callback(null, true)
        }
        if (env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
          return callback(null, true)
        }
        return callback(null, false)
      },
      credentials: true,
    }),
  )
  app.use(express.json({ limit: '1mb' }))
  app.use(pinoHttp({ logger }))

  const generationLimiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 20,
    message: 'Question generation rate limit reached. Please wait before generating more questions.',
  })
  const submissionLimiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 40,
    message: 'Submission rate limit reached. Please wait before submitting again.',
  })

  app.use('/api/health', healthRouter)
  app.use('/api/questions', generationLimiter, createQuestionRouter(questionService))
  app.use('/api/submissions', submissionLimiter, createSubmissionRouter(submissionService, repository))
  app.use('/api/attempts', createAttemptRouter(repository, questionService))
  app.use('/api/interviewer', generationLimiter, createInterviewerRouter(interviewerService))

  app.use(notFoundHandler)
  app.use(errorHandler)
  return app
}
