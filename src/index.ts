import type { Plugin } from 'cordis'
import { host } from './host.js'

export interface LlmFallbackConfig {
  providers?: string[]
  timeout?: number
  retries?: number
  healthCheck?: boolean
}

export default function dshLlmFallback(config: LlmFallbackConfig = {}): Plugin {
  return {
    name: 'dsh-llm-fallback',
    apply: (ctx) => host(ctx, config),
  }
}

export * from './types.js'