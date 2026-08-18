import type { Context } from 'cordis'
import type { LlmFallbackService } from '../host.js'
import type { CommandResultShape } from './balance.js'

/**
 * 创建 `/llm-fallback-status` 处理器:展示当前 provider、健康/延迟/熔断状态。
 */
export function createStatusHandler(
  ctx: Context,
  service: LlmFallbackService,
): () => Promise<CommandResultShape> {
  return async () => {
    const current = service.current
    const list = service.healthList
    if (list.length === 0) {
      return {
        kind: 'error',
        text: '暂无已跟踪的 LLM provider。请先注册一个带 chat() 方法的服务(如 ctx.llm = {...}),或用 providers 白名单指定。',
      }
    }
    const rows = list
      .map((h) => {
        const breaker = h.downUntil !== undefined
          ? `熔断至 ${new Date(h.downUntil).toLocaleTimeString('zh-CN')}`
          : h.consecutiveFailures > 0
            ? `${h.consecutiveFailures} 次`
            : '-'
        return `| ${h.name} | ${h.healthy ? '✅' : '❌'} | ${h.latency !== undefined ? `${h.latency}ms` : '-'} | ${breaker} |`
      })
      .join('\n')
    const text = [
      '## 🔀 LLM 回替链状态',
      '',
      `**当前优先**:${current?.name ?? '无'}`,
      '',
      '| Provider | 健康 | 延迟 | 熔断 |',
      '|----------|------|------|------|',
      rows,
    ].join('\n')
    return { kind: 'success', text }
  }
}
