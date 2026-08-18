import type { Context } from 'cordis'
import { LlmFallbackService, type LlmFallbackConfig } from './host.js'
import { createBalanceHandler } from './commands/balance.js'
import { createStatusHandler } from './commands/status.js'

export { LlmFallbackService } from './host.js'
export type { LlmFallbackConfig } from './host.js'
export * from './types.js'

export const name = 'dsh-llm-fallback'

/**
 * DSH / Cordis 插件入口。
 * - 挂载 ctx.llmFallback 回替服务(setter 赋值,不依赖 ready 时序)
 * - 在 DSH 宿主中注册 `/llm-fallback-balance` 与 `/llm-fallback-status` 命令
 *   (ctx.commands 由 @deepseek-ai/dsh-commands 提供;纯 cordis 环境自动跳过)
 */
export function apply(ctx: Context, config: LlmFallbackConfig = {}): void {
  // 1) 回替服务
  const service = new LlmFallbackService(ctx, config)
  ;(ctx as any).llmFallback = service
  ctx.on('dispose', () => {
    if ((ctx as any).llmFallback === service) {
      ;(ctx as any).llmFallback = null
    }
    service.dispose()
  })

  // 2) DSH 命令(宿主提供 commands 服务时注册)
  const commands = (ctx as any).get?.('commands') ?? (ctx as any).commands
  if (commands?.register) {
    const disposeBalance = commands.register({
      name: 'llm-fallback-balance',
      description: '查询当前 DeepSeek 账户余额',
      handler: createBalanceHandler(ctx, config),
    })
    const disposeStatus = commands.register({
      name: 'llm-fallback-status',
      description: '查看 LLM 回替链状态(当前 provider / 健康 / 熔断)',
      handler: createStatusHandler(ctx, service),
    })
    ctx.on('dispose', disposeBalance)
    ctx.on('dispose', disposeStatus)
  }
}
