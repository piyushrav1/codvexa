# Codvexa

Codvexa is an AI-powered coding practice and technical interview platform. It combines LeetCode/HackerRank-style problem generation powered by Google Gemini, an independent AI verification auditor, a configurable multi-language execution engine (**Judge0**, **Docker**, or **Mock**), an **AI Technical Interviewer** with Socratic follow-ups and a `+` / `-` code fix diff viewer, and a Monaco-based coding workspace styled in a **Dark + Electric Violet (`#6834EC`)** design system.

---

## Key Features

- **6-Stage Closed-Loop Question Pipeline**:
  1. Topic, mixed-category, & difficulty selection (`Easy`, `Medium`, `Hard`) with optional custom requirements and a full-screen generation splash overlay.
  2. Gemini problem generation in concise LeetCode/HackerRank style (lead summary, bullet rules, constraints, examples with explanations, and raw `stdin` test cases).
  3. **Independent Question Auditor**: Scrutinizes mathematical invariants, edge cases, input/output consistency, and ambiguity before approving.
  4. Sandbox execution of reference Python solutions.
  5. Authentic expected output computation from Judge0/Docker execution (eliminating hallucinated outputs).
  6. Persistence to database with hidden test cases strictly redacted from public payloads.
- **Universal 5-Language Runtime (`Judge0` + `Docker` + `Mock`)**:
  - Full execution support for **Python 3**, **JavaScript (Node.js)**, **Java**, **C++**, and **C**.
  - Configurable via `CODE_RUNNER=judge0|docker|mock` with optional `ALLOW_DOCKER_FALLBACK`.
  - Universal raw `stdin` tokenization compatible across all five languages without boilerplate format mismatches.
- **AI Technical Interviewer & Code Fixer**:
  - **Streaming Socratic Follow-Ups (`POST /api/interviewer/chat`)**: Server-Sent Events (SSE) chat grounded in your live editor code and latest test outcome (probing Big-O complexity/scaling on `accepted`, or edge cases/bugs on failures without spoiling hidden tests).
  - **Fix My Code (`POST /api/interviewer/fix`)**: Diagnoses what is wrong, explains the fix, renders a green `+` / red `-` line diff, and lets you apply the fix directly to the editor.
- **Monaco Code Workspace**:
  - Custom `codvexa-dark` Monaco theme (plus Light and System modes), configurable font size, and word wrap.
  - Pinned bottom footer with **Custom test cases**, **Run**, and **Submit** actions (`Ctrl/Cmd + Enter` shortcut).
  - Visual runtime badges (`Fast`, `Good`, `Slow`), side-by-side output diff viewer, code reset confirmation modal, and pause/resume/extend practice timer.
- **Platform Robustness & Persistence**:
  - Progressive 3-tier hint engine, Big-O theoretical complexity analyzer, sliding-window IP rate limiter (`X-RateLimit-*` headers), and 100 KB output caps.
  - MongoDB repository with automatic in-memory fallback and paginated question search (`GET /api/questions`).

---

## Technology Stack

- **Frontend**: React 19, TypeScript, Vite, Monaco Editor (`@monaco-editor/react`), Lucide React.
- **Backend**: Express, TypeScript, Zod, Helmet, Pino HTTP logging.
- **AI Engine**: Google Gemini API (`@google/genai`) with model fallback (`gemini-flash-lite-latest`, `gemini-3.5-flash`, `gemini-flash-latest`).
- **Execution Engine**: Judge0 (`Judge0CodeRunner`), Docker/native (`DockerCodeRunner`), and `MockCodeRunner`.
- **Database**: MongoDB with automatic in-memory fallback.

---

## Getting Started

### Prerequisites

- Node.js 20 or newer
- npm
- (Optional) Judge0 (`http://127.0.0.1:2358`) and/or Docker
- (Optional) MongoDB instance

### Installation & Environment Setup

```powershell
# 1. Install dependencies across all monorepo packages
npm.cmd install

# 2. Set up environment configuration files
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item apps/web/.env.example apps/web/.env
```

Open `apps/api/.env` and configure your environment:

```env
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-flash-lite-latest
PORT=4000
CODE_RUNNER=judge0
JUDGE0_URL=http://127.0.0.1:2358
ALLOW_DOCKER_FALLBACK=false
# Optional: MONGODB_URI=mongodb://localhost:27017
# Optional: MONGODB_DB=codvexa
```

### Running the Application

```powershell
# Start both Frontend and API together
npm.cmd run dev:all
```

- **Frontend Application**: `http://localhost:5173`
- **Backend API**: `http://localhost:4000`
- **API Health Check**: `http://localhost:4000/api/health`

---

## Available Commands

| Command | Description |
|---|---|
| `npm.cmd run dev:all` | Start both the frontend and backend concurrently |
| `npm.cmd run dev` | Start the Vite development server for the web app |
| `npm.cmd run server` | Start the Express backend with hot-reload (`tsx watch`) |
| `npm.cmd run typecheck` | Perform TypeScript type checks across client and server |
| `npm.cmd test` | Run all unit and integration tests |
| `npm.cmd run build` | Build the web frontend for production |
| `npm.cmd run check` | Run typecheck, tests, and production build |

---

## Project Structure

```text
├── apps/
│   ├── api/                     # Express REST & SSE API
│   │   ├── server/src/          # Routes (questions, submissions, attempts, interviewer)
│   │   └── tsconfig.server.json
│   └── web/                     # React 19 + Vite frontend
│       ├── src/                 # Workspace UI, InterviewerPanel, Monaco theme, apiClient
│       └── vite.config.ts
├── services/
│   ├── question-engine/         # Gemini generator, auditor, interviewerService, repository
│   └── execution-engine/        # Judge0CodeRunner, DockerCodeRunner, MockCodeRunner, submissionService
├── packages/
│   ├── shared/                  # Common TypeScript interfaces, DTOs, and type guards
│   └── ui/                      # Reusable UI component package
└── docs/
    └── architecture/            # Architecture specs and API docs
```

---

## Security & Production Guidelines

- **Sandbox Isolation**: Untrusted code is executed inside Judge0 or isolated Docker containers with CPU, memory, timeout, output-size, and network limits.
- **Credential & Test Case Protection**: Hidden test case outputs and reference solutions are scrubbed by `QuestionRepository` and `QuestionService` prior to returning responses to clients.

---

## License

MIT
