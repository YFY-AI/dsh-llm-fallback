import type { Context } from 'cordis'
import type { LlmFallbackConfig } from '../host.js'

export interface CommandResultShape {
  kind: 'success' | 'error'
  text: string
}

/**
 * 创建 `/llm-fallback-balance` 处理器。
 * 返回结构符合 @deepseek-ai/dsh-commands 的 CommandResult 规范:
 * { kind: 'success'|'error', text }。
 */
export function createBalanceHandler(
  ctx: Context,
  config: LlmFallbackConfig,
): (invocation: { rawInput: string; signal: AbortSignal }) => Promise<CommandResultShape> {
  return async (invocation) => {
    const apiKey = config.apiKey ?? process.env.DEEPSEEK_API_KEY
    if (!apiKey) {
      return {
        kind: 'error',
        text: '未配置 DeepSeek API Key:请在插件配置中设置 apiKey,或设置环境变量 DEEPSEEK_API_KEY',
      }
    }
    try {
      const res = await fetch('https://api.deepseek.com/user/balance', {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: invocation.signal,
      })
      if (!res.ok) {
        return { kind: 'error', text: `余额查询失败:HTTP ${res.status}` }
      }
      const data: any = await res.json()
      const info = data?.balance_infos?.[0]
      if (!info) {
        return { kind: 'error', text: '余额查询失败:响应格式异常(缺少 balance_infos)' }
      }
      const text = [
        '## 💰 DeepSeek 账户余额',
        '',
        '| 项目 | 金额 |',
        '|------|------|',
        `| 总余额 | **${info.total_balance} ${info.currency}** |`,
        `| 赠送额度 | ${info.granted_balance} ${info.currency} |`,
        `| 充值额度 | ${info.topped_up_balance} ${info.currency} |`,
        '',
        `**账户状态**:${data.is_available ? '✅ 可用' : '❌ 不可用'}`,
        '',
        `*最后更新:${new Date().toLocaleString('zh-CN')}*`,
      ].join('\n')
      return { kind: 'success', text }
    } catch (error) {
      if (invocation.signal.aborted) {
        return { kind: 'error', text: '查询已取消' }
      }
      return { kind: 'error', text: `余额查询失败:${error instanceof Error ? error.message : String(error)}` }
    }
  }
}
