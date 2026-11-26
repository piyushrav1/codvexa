import type { CodeRunner } from './codeRunner.js'
import { DockerCodeRunner } from './dockerCodeRunner.js'
import { FallbackCodeRunner, Judge0CodeRunner } from './judge0CodeRunner.js'
import { MockCodeRunner } from './mockCodeRunner.js'

export type CodeRunnerMode = 'docker' | 'judge0' | 'mock'

export interface CodeRunnerFactoryConfig {
  mode?: CodeRunnerMode | undefined
  judge0Url?: string | undefined
  judge0Key?: string | undefined
  judge0Host?: string | undefined
  allowDockerFallback?: boolean | undefined
}

/**
 * Build the configured CodeRunner for the execution engine.
 * - 'docker': local Docker sandbox with native runtime fallback (default).
 * - 'judge0': remote/self-hosted Judge0 sandbox, optionally falling back to Docker.
 * - 'mock': fast deterministic mock runner for offline dev/testing.
 */
export function createCodeRunner(config: CodeRunnerFactoryConfig = {}): CodeRunner {
  const mode = config.mode ?? 'docker'

  if (mode === 'mock') {
    return new MockCodeRunner()
  }

  if (mode === 'judge0') {
    const judge0 = new Judge0CodeRunner({
      baseUrl: config.judge0Url,
      apiKey: config.judge0Key,
      rapidApiHost: config.judge0Host,
    })

    if (config.allowDockerFallback) {
      return new FallbackCodeRunner(judge0, new DockerCodeRunner(), true)
    }
    return judge0
  }

  return new DockerCodeRunner()
}

