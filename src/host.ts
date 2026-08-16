import { Context } from 'cordis'
import type { Service } from 'cordis'
import type { LlmFallbackConfig } from './index.js'
import type { LlmChatOptions, LlmEmbeddingOptions, LlmMessage } from './types.js'

export interface LlmProvider extends Service {
  name: string
  chat(messages: LlmMessage[], options?: LlmChatOptions): Promise<any>
  embeddings(input: string[], options?: LlmEmbeddingOptions): Promise<any>
  healthCheck?(): Promise<boolean>
}

declare module 'cordis' {
  interface Context {
    llmFallback: {
      current: LlmProvider | null
      providers: LlmProvider[]
      switchTo(name: string): boolean
      chat(messages: LlmMessage[], options?: LlmChatOptions): Promise<any>
      embeddings(input: string[], options?: LlmEmbeddingOptions): Promise<any>
    }
  }
}

export function host(ctx: Context, config: LlmFallbackConfig) {
  const {
    providers: providerNames = [],
    timeout = 30000,
    retries = 2,
    healthCheck = true,
  } = config

  const providers: LlmProvider[] = []
  let current: LlmProvider | null = null

  // 监听服务注册（使用 Cordis 内置事件）
  ctx.on('internal/service', (name: string) => {
    const svc = (ctx as any)[name] as LlmProvider | undefined
    if (svc && (providerNames.length === 0 || providerNames.includes(svc.name))) {
      providers.push(svc)
      if (!current) current = svc
    }
  })

  // 服务移除时清理（Cordis 没有内置移除事件，依靠 dispose 生命周期）
  ctx.on('dispose', () => {
    providers.length = 0
    current = null
  })

  // 核心：带回退的调用
  async function callWithFallback<T>(
    fn: (p: LlmProvider) => Promise<T>,
    _opName: string
  ): Promise<T> {
    const ordered = [...providers]
    if (current) {
      const i = ordered.indexOf(current)
      if (i > 0) [ordered[0], ordered[i]] = [ordered[i], ordered[0]]
    }

    let lastError: Error
    for (const p of ordered) {
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), timeout)
          const result = await fn(p)
          clearTimeout(timer)
          current = p
          return result
        } catch (e) {
          lastError = e as Error
          if (attempt === retries) break
          await new Promise(r => setTimeout(r, 200 * (attempt + 1)))
        }
      }
    }
    throw lastError!
  }

  // 注册统一服务（使用 ctx.service）
  const fallbackService = {
    get current() { return current },
    get providers() { return providers },
    switchTo(name: string) {
      const p = providers.find(p => p.name === name)
      if (p) { current = p; return true }
      return false
    },
    chat(messages: LlmMessage[], options?: LlmChatOptions) {
      return callWithFallback(p => p.chat(messages, options), 'chat')
    },
    embeddings(input: string[], options?: LlmEmbeddingOptions) {
      return callWithFallback(p => p.embeddings(input, options), 'embeddings')
    },
  }

  // 注册为 Cordis 服务
  ;(Context as any).service('llmFallback', fallbackService)

  // 可选健康探测
  if (healthCheck) {
    const timer = setInterval(async () => {
      for (const p of providers) {
        if (p.healthCheck) {
          try {
            await p.healthCheck()
          } catch {
            // 标记不可用，实际可结合熔断器
          }
        }
      }
    }, 60_000)
    ctx.on('dispose', () => clearInterval(timer))
  }
}