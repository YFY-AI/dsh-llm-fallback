import { Context } from 'cordis'
import type { LlmChatOptions, LlmEmbeddingOptions, LlmMessage, LlmProvider, ProviderHealth } from './types.js'

const SERVICE_NAME = 'llmFallback'

// 注册 Cordis 服务访问器(幂等):让 ctx.llmFallback = value 走 setter 逻辑
// (存储到 app + 触发 internal/service),使回替服务跨 context 可见且可被事件跟踪。
Context.service(SERVICE_NAME)

export interface LlmFallbackConfig {
  /** provider 白名单(按优先级);空数组 = 自动发现所有带 chat 方法的服务 */
  providers?: string[]
  /** 单次调用超时(ms) */
  timeout?: number
  /** 单个 provider 的连续重试次数 */
  retries?: number
  /** 是否启用周期健康探测 */
  healthCheck?: boolean
  /** 健康探测间隔(ms) */
  healthCheckInterval?: number
  /** 熔断参数:连续失败阈值 + 冷却时长 */
  circuitBreaker?: {
    failures?: number
    cooldown?: number
  }
  /** DeepSeek 余额查询 API key(优先于 process.env.DEEPSEEK_API_KEY) */
  apiKey?: string
}

interface ResolvedConfig {
  providers: string[]
  timeout: number
  retries: number
  healthCheck: boolean
  healthCheckInterval: number
  failures: number
  cooldown: number
}

/**
 * LLM 回替链服务(工厂对象,apply 时显式挂载到 ctx.llmFallback)。
 *
 * 设计要点(相对 v0.2 的修复):
 * - 挂载方式:ctx[name] = service(setter 触发 cordis `internal/service`,且不依赖 ready 时序)
 * - 超时:AbortSignal 真实传导到 provider 调用,finally 中清理 timer
 * - 健康:周期探测 + 调用结果更新;连续失败达阈值触发熔断(冷却期跳过)
 * - 快照:每次调用按"白名单优先级 + 当前粘性 + 熔断过滤"重排,避免并发共享指针竞态
 * - 空 providers:抛出明确错误而非 throw undefined
 */
export class LlmFallbackService {
  private readonly ctx: Context
  private readonly cfg: ResolvedConfig
  private readonly providers = new Map<string, LlmProvider>()
  private readonly health = new Map<string, ProviderHealth>()
  private currentName: string | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private disposed = false

  constructor(ctx: Context, config: LlmFallbackConfig = {}) {
    this.ctx = ctx
    this.cfg = {
      providers: config.providers ?? [],
      timeout: config.timeout ?? 30_000,
      retries: config.retries ?? 2,
      healthCheck: config.healthCheck ?? true,
      healthCheckInterval: config.healthCheckInterval ?? 60_000,
      failures: config.circuitBreaker?.failures ?? 3,
      cooldown: config.circuitBreaker?.cooldown ?? 30_000,
    }
    // 捕获后续注册的 chat 服务(internal/service 在 setter 赋值时触发)
    ctx.on('internal/service', (name: string) => this.track(name))
    // 补扫 apply 之前已挂载的服务(尽力而为,见 scanExisting 注释)
    this.scanExisting()
    if (this.cfg.healthCheck) {
      this.timer = setInterval(() => void this.probeAll(), this.cfg.healthCheckInterval)
      this.timer.unref?.()
    }
  }

  /** 卸载服务:清定时器、清状态(由 apply 的 dispose 钩子调用) */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.providers.clear()
    this.health.clear()
    this.currentName = null
  }

  // ── provider 收集 ────────────────────────────────────────────────

  private track(name: string): void {
    if (name === SERVICE_NAME) return
    const svc = (this.ctx as any)[name]
    if (!svc || typeof svc.chat !== 'function') return
    const provider = svc as LlmProvider
    const providerName = provider.name ?? name
    if (this.providers.has(providerName)) return
    if (this.cfg.providers.length > 0 && !this.cfg.providers.includes(providerName)) return
    this.providers.set(providerName, provider)
    this.health.set(providerName, {
      name: providerName,
      healthy: true,
      lastCheck: Date.now(),
      consecutiveFailures: 0,
    })
    if (!this.currentName) this.currentName = providerName
    this.log('info', `tracked provider "${providerName}" (total ${this.providers.size})`)
  }

  /**
   * 尽力而为的初始扫描:internal/service 只覆盖"本服务创建之后"的赋值。
   * cordis 的 app 用 symbol 键存储已赋值服务,这里遍历 symbol 属性补漏。
   */
  private scanExisting(): void {
    const app = (this.ctx as any).app ?? this.ctx
    for (const key of Object.getOwnPropertySymbols(app)) {
      const svc = app[key]
      if (svc && typeof svc === 'object' && typeof svc.chat === 'function') {
        const provider = svc as LlmProvider
        const providerName = provider.name ?? String(key.description ?? 'anonymous')
        if (providerName === SERVICE_NAME) continue
        if (this.providers.has(providerName)) continue
        if (this.cfg.providers.length > 0 && !this.cfg.providers.includes(providerName)) continue
        this.providers.set(providerName, provider)
        this.health.set(providerName, {
          name: providerName,
          healthy: true,
          lastCheck: Date.now(),
          consecutiveFailures: 0,
        })
        if (!this.currentName) this.currentName = providerName
      }
    }
  }

  // ── 排序 / 熔断 ──────────────────────────────────────────────────

  private orderedProviders(): LlmProvider[] {
    const all = [...this.providers.values()]
    let ordered = all
    if (this.cfg.providers.length > 0) {
      ordered = [...all].sort((a, b) => {
        const ia = this.cfg.providers.indexOf(a.name)
        const ib = this.cfg.providers.indexOf(b.name)
        return (ia === -1 ? Number.POSITIVE_INFINITY : ia) - (ib === -1 ? Number.POSITIVE_INFINITY : ib)
      })
    }
    // 当前 provider 粘性置顶(切换偏好)
    if (this.currentName) {
      const i = ordered.findIndex((p) => p.name === this.currentName)
      if (i > 0) {
        const [p] = ordered.splice(i, 1)
        ordered.unshift(p)
      }
    }
    // 过滤熔断冷却中的 provider
    const now = Date.now()
    return ordered.filter((p) => {
      const h = this.health.get(p.name)
      return !(h && h.downUntil !== undefined && h.downUntil > now)
    })
  }

  private recordSuccess(provider: LlmProvider, latency: number): void {
    this.health.set(provider.name, {
      name: provider.name,
      healthy: true,
      latency,
      lastCheck: Date.now(),
      consecutiveFailures: 0,
      downUntil: undefined,
    })
    this.currentName = provider.name
  }

  private recordFailure(provider: LlmProvider, error: unknown): void {
    const prev = this.health.get(provider.name) ?? {
      name: provider.name,
      healthy: true,
      lastCheck: Date.now(),
      consecutiveFailures: 0,
    }
    const failures = prev.consecutiveFailures + 1
    const tripped = failures >= this.cfg.failures
    const downUntil = tripped ? Date.now() + this.cfg.cooldown : prev.downUntil
    this.health.set(provider.name, {
      ...prev,
      healthy: downUntil === undefined,
      consecutiveFailures: failures,
      downUntil,
      lastCheck: Date.now(),
    })
    if (tripped && prev.downUntil === undefined) {
      this.log('warn', `provider "${provider.name}" tripped circuit breaker for ${this.cfg.cooldown}ms after ${failures} consecutive failures (${error instanceof Error ? error.message : String(error)})`)
    }
  }

  // ── 健康探测 ─────────────────────────────────────────────────────

  private async probeAll(): Promise<void> {
    for (const provider of this.providers.values()) {
      if (typeof provider.healthCheck !== 'function') continue
      const t0 = Date.now()
      try {
        await provider.healthCheck()
        this.recordSuccess(provider, Date.now() - t0)
      } catch (error) {
        this.recordFailure(provider, error)
      }
    }
  }

  // ── 核心调用 ─────────────────────────────────────────────────────

  private async callWithTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(
      () => controller.abort(new Error(`timeout after ${this.cfg.timeout}ms`)),
      this.cfg.timeout,
    )
    try {
      return await fn(controller.signal)
    } finally {
      clearTimeout(timer)
    }
  }

  private async callWithFallback<T>(
    op: string,
    invoke: (provider: LlmProvider, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const ordered = this.orderedProviders()
    if (ordered.length === 0) {
      const detail = this.providers.size === 0
        ? 'no provider registered (register a service with chat())'
        : 'all providers are in circuit-breaker cooldown'
      throw new Error(`llm-fallback: no available provider for "${op}" — ${detail}`)
    }
    let lastError: unknown
    for (const provider of ordered) {
      for (let attempt = 0; attempt <= this.cfg.retries; attempt++) {
        try {
          const t0 = Date.now()
          const result = await this.callWithTimeout((signal) => invoke(provider, signal))
          this.recordSuccess(provider, Date.now() - t0)
          return result
        } catch (error) {
          lastError = error
          this.recordFailure(provider, error)
          if (attempt === this.cfg.retries) break
          await new Promise((r) => setTimeout(r, 200 * (attempt + 1)))
        }
      }
    }
    const message = lastError instanceof Error ? lastError.message : String(lastError)
    throw new Error(`llm-fallback: all providers failed for "${op}"; last error: ${message}`, { cause: lastError })
  }

  // ── 公开 API ─────────────────────────────────────────────────────

  get current(): LlmProvider | null {
    return this.currentName ? this.providers.get(this.currentName) ?? null : null
  }

  get providersList(): LlmProvider[] {
    return [...this.providers.values()]
  }

  get healthList(): ProviderHealth[] {
    return [...this.health.values()]
  }

  /** 手动切换当前优先 provider */
  switchTo(name: string): boolean {
    if (this.providers.has(name)) {
      this.currentName = name
      return true
    }
    return false
  }

  chat(messages: LlmMessage[], options: LlmChatOptions = {}): Promise<unknown> {
    return this.callWithFallback('chat', (provider, signal) =>
      provider.chat(messages, { ...options, signal }))
  }

  embeddings(input: string[], options: LlmEmbeddingOptions = {}): Promise<unknown> {
    return this.callWithFallback('embeddings', (provider, signal) =>
      provider.embeddings ? provider.embeddings(input, { ...options, signal }) : Promise.reject(new Error('provider does not support embeddings')))
  }

  // ── 内部工具 ─────────────────────────────────────────────────────

  private log(level: 'info' | 'warn', message: string): void {
    const logger = (this.ctx as any).logger
    if (logger && typeof logger[level] === 'function') {
      logger[level](`[dsh-llm-fallback] ${message}`)
    }
  }
}
