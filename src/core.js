// dsh-llm-fallback core:纯函数回退决策逻辑(从生产 mjs 抽取,可独立测试)。
// 不依赖任何外部状态:cooldowns / usage / chain 全部显式传入。

/**
 * 渠道族:同族优先回退(商汤①→②③、火山①→②),跨族只作最后手段。
 */
export function providerFamily(provider) {
  if (provider.startsWith('volcengine-ark')) return 'volcengine'
  if (provider.startsWith('hcnsec')) return 'hcnsec'
  if (provider.startsWith('sensenova')) return 'sensenova'
  return provider
}

/** 渠道显示名(状态 API / 侧边栏 / UI 通知)。 */
export function displayNameOf(provider) {
  const map = {
    'volcengine-ark': '火山方舟①',
    'volcengine-ark-2': '火山方舟②',
    'hcnsec-1': '幻城网安①',
    'hcnsec-2': '幻城网安②',
    'sensenova-1': '商汤日日新①',
    'sensenova-2': '商汤日日新②',
    'sensenova-3': '商汤日日新③',
    'deepseek-official': 'DeepSeek 官方',
  }
  return map[provider] ?? provider
}

export function cooldownKey(provider, model) {
  return provider + '|' + model
}

/**
 * 计算某失败的冷却截止时间与原因。
 * @param {object} cfg - { quotaCooldownMs, serverCooldownMs, rateLimitCooldownMs, sensenovaRateLimitCooldownMs }
 * @param {object|null} usage - 当前 usage 快照(QUOTA 时用于取 5h 重置时间)
 */
export function cooldownFor(code, provider, model, failure, cfg, usage) {
  if (failure?.providerRetryAfterMs && Number.isFinite(failure.providerRetryAfterMs) && failure.providerRetryAfterMs > 0) {
    return { until: Date.now() + failure.providerRetryAfterMs, reason: '上游指定重试时间' }
  }
  if (code === 'QUOTA') {
    const w5 = usage?.ark?.['5h']?.reset_at
    if (w5) {
      const reset = Date.parse(w5)
      if (Number.isFinite(reset)) return { until: reset, reason: '额度重置' }
    }
    return { until: Date.now() + cfg.quotaCooldownMs, reason: '额度不足' }
  }
  if (code === 'SERVER') {
    // 500 多为厂商端临时故障,短冷却避免频繁重试同一渠道
    return { until: Date.now() + cfg.serverCooldownMs, reason: '服务端错误' }
  }
  // RATE_LIMIT 通常是短时限流(并发/频率),不是额度耗尽。
  // 商汤 Token Plan 的 RATE_LIMIT 也多为瞬时限制——用短冷却,
  // 避免把仍有额度的渠道长时间误冷却。真正的额度耗尽会表现为 QUOTA。
  if (provider.startsWith('sensenova-')) {
    return { until: Date.now() + cfg.sensenovaRateLimitCooldownMs, reason: '短时限流' }
  }
  return { until: Date.now() + cfg.rateLimitCooldownMs, reason: '限流冷却' }
}

/**
 * 路由是否当前不可用(冷却中 / 火山方舟额度耗尽 / 商汤非 ok)。
 * @param {Map} cooldowns - cooldownKey -> { until, reason }
 * @param {object|null} usage - usage 快照
 * @param {object} cfg - { arkThreshold }
 */
export function routeUnavailable(provider, model, cooldowns, usage, cfg) {
  const key = cooldownKey(provider, model)
  const cool = cooldowns.get(key)
  if (cool && cool.until > Date.now()) return true
  if (provider.startsWith('volcengine-ark')) {
    const ark = usage?.ark
    if (ark) {
      const w5 = ark['5h']
      if (w5 && typeof w5.percent === 'number' && w5.percent >= cfg.arkThreshold) return true
    }
  }
  if (provider.startsWith('sensenova-')) {
    const idx = provider.replace('sensenova-', '')
    const s = usage?.sensenova?.[idx]
    if (s && s.status !== 'ok') return true
  }
  return false
}

/**
 * 选择回退目标:优先级 1 同 provider 其它 model → 2 同渠道族其它 provider → 3 跨族按链序。
 * 链末位(ultimate)默认永远可用,避免真实失败被吞成死循环。
 * @param {string} skipProvider - 刚失败的 provider
 * @param {string} skipModel - 刚失败的 model
 * @param {Array} chain - [{ provider, model }, ...]
 * @param {Map} cooldowns
 * @param {object|null} usage
 * @param {object} cfg - { arkThreshold, skipUltimateByUsage }
 * @returns {{provider:string, model:string}|null}
 */
/**
 * 校验并归一化 chain 数组(拖拽排序持久化的新顺序)。
 * @param {unknown} value
 * @returns {Array<{provider:string, model:string}>|null} 合法返回数组,否则 null
 */
export function validateChain(value) {
  if (!Array.isArray(value)) return null
  const out = []
  for (const item of value) {
    if (item && typeof item === 'object' && typeof item.provider === 'string' && typeof item.model === 'string') {
      out.push({ provider: item.provider, model: item.model })
    }
  }
  return out.length > 0 ? out : null
}

/**
 * 选择回退目标:严格沿 chain 从头找第一个「可用 且 不是刚失败那一条」的渠道。
 * 不做同 provider/同渠道族优先——chain 顺序即为完整回退顺序(拖拽即全局排序)。
 * 冷却/usage 耗尽的渠道跳过;链末位(ultimate)默认永远可用,避免真实失败被吞成死循环。
 * @param {string} skipProvider - 刚失败的 provider
 * @param {string} skipModel - 刚失败的 model
 * @param {Array} chain - [{ provider, model }, ...](此处即"当前生效顺序")
 * @param {Map} cooldowns
 * @param {object|null} usage
 * @param {object} cfg - { arkThreshold, skipUltimateByUsage }
 * @returns {{provider:string, model:string}|null}
 */
export function pickFallbackTarget(skipProvider, skipModel, chain, cooldowns, usage, cfg) {
  const usable = (route, i) =>
    i === chain.length - 1 && !cfg.skipUltimateByUsage
      ? true
      : !routeUnavailable(route.provider, route.model, cooldowns, usage, cfg)
  // 严格链序扫描:每次失败后都从 chain[0] 重新找第一个可用,而非从失败渠道附近起步
  for (let i = 0; i < chain.length; i++) {
    const route = chain[i]
    // 避免原地重试刚失败的同一路由
    if (route.provider === skipProvider && route.model === skipModel) continue
    if (usable(route, i)) return route
  }
  return chain[chain.length - 1] ?? null
}

/**
 * 截断避让:当前渠道在"截断冷却"内时,返回替代路由(下一条可用渠道)。
 * 截断冷却由 host 在 turn/end max-tokens 时记录;下次请求(含用户"继续")
 * 自动避开该渠道,避免反复截断。
 * @param {string} provider - 当前解析的 provider
 * @param {string} model - 当前解析的 model
 * @param {Array} chain
 * @param {Map} cooldowns - 熔断冷却(与截断无关,透传给 pickFallbackTarget)
 * @param {Map} truncated - cooldownKey -> until(截断冷却)
 * @param {object} cfg - { arkThreshold, skipUltimateByUsage }
 * @returns {{provider:string, model:string}|null} 替代路由;无需切换返回 null
 */
export function avoidTruncated(provider, model, chain, cooldowns, truncated, cfg) {
  const key = cooldownKey(provider, model)
  const until = truncated.get(key)
  if (!until || until <= Date.now()) return null
  // 截断标记并入可用性判断:被截断的渠道视为"冷却中",选择时跳过
  const now = Date.now()
  const merged = new Map(cooldowns)
  for (const [k, t] of truncated) {
    if (t > now && !merged.has(k)) merged.set(k, { until: t, reason: 'truncated' })
  }
  const alt = pickFallbackTarget(provider, model, chain, merged, null, cfg)
  if (!alt) return null
  if (alt.provider === provider && alt.model === model) return null
  return alt
}

/**
 * 滑动窗口指标:追加一次请求结果,返回新窗口数组(固定最大长度,超长丢最旧)。
 * 每条记录 { ok: boolean, latencyMs: number|null }。窗口本身纯数据,
 * 统计交给 windowSummary,host 仅负责追加与持久化。
 * @param {Array|null} window - 旧窗口(可 null)
 * @param {boolean} ok - 是否成功(截断按"成功但输出不完整"计 ok,单独统计截断数)
 * @param {number|null} latencyMs - 本次延迟;未知传 null
 * @param {number} maxSize - 窗口上限,默认 20
 * @returns {Array} 新窗口
 */
export function pushWindowMetric(window, ok, latencyMs, maxSize = 20) {
  const entry = {
    ok: Boolean(ok),
    latencyMs: Number.isFinite(latencyMs) && latencyMs >= 0 ? latencyMs : null,
  }
  const next = (window ?? []).concat(entry)
  return next.length > maxSize ? next.slice(next.length - maxSize) : next
}

/**
 * 窗口统计摘要(纯函数,便于测试与 status API 直接消费)。
 * @param {Array|null} window - pushWindowMetric 产出的窗口
 * @returns {{ rate:number|null, okCount:number, failCount:number, avgLatencyMs:number|null, count:number }}
 *   rate 为成功占比 0-1(空窗口 null);avgLatencyMs 为已知延迟的均值(ms,取整)。
 */
export function windowSummary(window) {
  if (!window || window.length === 0) {
    return { rate: null, okCount: 0, failCount: 0, avgLatencyMs: null, count: 0 }
  }
  let ok = 0
  let latSum = 0
  let latCount = 0
  for (const e of window) {
    if (e.ok) ok++
    if (Number.isFinite(e.latencyMs) && e.latencyMs >= 0) {
      latSum += e.latencyMs
      latCount++
    }
  }
  return {
    rate: ok / window.length,
    okCount: ok,
    failCount: window.length - ok,
    avgLatencyMs: latCount > 0 ? Math.round(latSum / latCount) : null,
    count: window.length,
  }
}
