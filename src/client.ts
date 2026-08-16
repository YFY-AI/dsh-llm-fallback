import type { Context } from 'cordis'

// Client 侧：如需在浏览器端注册 Slot / Theme / RPC，在此实现
// 目前回退逻辑全在 Host 侧，Client 侧暂留空
export function client(ctx: Context) {
  // 示例：向 Host 请求当前提供商列表
  // const list = await ctx.rpc.call('llmFallback.listProviders')
  // ctx.slot('llm-fallback-status', () => <span>当前: {list.current}</span>)
}