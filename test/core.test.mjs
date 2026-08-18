// core.js 纯函数单元测试
// 运行:node test/core.test.mjs(构建后 lib/core.js;测试直接引 src 亦可)
import assert from 'node:assert/strict'
import {
  cooldownFor,
  cooldownKey,
  displayNameOf,
  pickFallbackTarget,
  providerFamily,
  routeUnavailable,
  validateChain,
} from '../lib/core.js'

// ── providerFamily ──
assert.equal(providerFamily('volcengine-ark'), 'volcengine')
assert.equal(providerFamily('volcengine-ark-2'), 'volcengine')
assert.equal(providerFamily('sensenova-1'), 'sensenova')
assert.equal(providerFamily('hcnsec-1'), 'hcnsec')
assert.equal(providerFamily('deepseek-official'), 'deepseek-official')
console.log('✔ providerFamily')

// ── displayNameOf ──
assert.equal(displayNameOf('volcengine-ark'), '火山方舟①')
assert.equal(displayNameOf('sensenova-2'), '商汤日日新②')
assert.equal(displayNameOf('unknown-x'), 'unknown-x')
console.log('✔ displayNameOf')

// ── cooldownKey / cooldownFor ──
assert.equal(cooldownKey('a', 'm'), 'a|m')
const cfg = {
  quotaCooldownMs: 3600_000,
  serverCooldownMs: 600_000,
  rateLimitCooldownMs: 1800_000,
  sensenovaRateLimitCooldownMs: 300_000,
}
const now = Date.now()
// 上游指定重试时间优先
const retry = cooldownFor('QUOTA', 'a', 'm', { providerRetryAfterMs: 5000 }, cfg, null)
assert.ok(retry.until > now && retry.until - now <= 5000 + 50, 'providerRetryAfterMs honored')
assert.equal(retry.reason, '上游指定重试时间')
// QUOTA 且 usage 有 reset_at → 用重置时间
const q = cooldownFor('QUOTA', 'a', 'm', null, cfg, { ark: { '5h': { reset_at: new Date(now + 9999).toISOString() } } })
assert.equal(q.reason, '额度重置')
assert.ok(q.until > now + 9000)
// QUOTA 无 reset → 默认冷却
const q2 = cooldownFor('QUOTA', 'a', 'm', null, cfg, null)
assert.equal(q2.reason, '额度不足')
assert.ok(q2.until - now >= cfg.quotaCooldownMs && q2.until - now < cfg.quotaCooldownMs + 100)
// SERVER → 短冷却
const s = cooldownFor('SERVER', 'a', 'm', null, cfg, null)
assert.equal(s.reason, '服务端错误')
assert.ok(s.until - now >= cfg.serverCooldownMs && s.until - now < cfg.serverCooldownMs + 100)
// 商汤 RATE_LIMIT → 更短冷却
const sr = cooldownFor('RATE_LIMIT', 'sensenova-1', 'm', null, cfg, null)
assert.equal(sr.reason, '短时限流')
assert.ok(sr.until - now >= cfg.sensenovaRateLimitCooldownMs && sr.until - now < cfg.sensenovaRateLimitCooldownMs + 100)
// 其它 RATE_LIMIT → 常规冷却
const r = cooldownFor('RATE_LIMIT', 'hcnsec-1', 'm', null, cfg, null)
assert.equal(r.reason, '限流冷却')
assert.ok(r.until - now >= cfg.rateLimitCooldownMs && r.until - now < cfg.rateLimitCooldownMs + 100)
console.log('✔ cooldownFor')

// ── routeUnavailable ──
const cooldowns = new Map()
const useCfg = { arkThreshold: 85 }
assert.equal(routeUnavailable('a', 'm', cooldowns, null, useCfg), false)
cooldowns.set('a|m', { until: Date.now() + 100_000 })
assert.equal(routeUnavailable('a', 'm', cooldowns, null, useCfg), true)
// 火山方舟:5h 用量超阈值 → 不可用
assert.equal(routeUnavailable('volcengine-ark', 'm', new Map(), { ark: { '5h': { percent: 90 } } }, useCfg), true)
assert.equal(routeUnavailable('volcengine-ark', 'm', new Map(), { ark: { '5h': { percent: 50 } } }, useCfg), false)
// 商汤:usage status 非 ok → 不可用
assert.equal(routeUnavailable('sensenova-1', 'm', new Map(), { sensenova: { 1: { status: 'quota_exhausted' } } }, useCfg), true)
assert.equal(routeUnavailable('sensenova-1', 'm', new Map(), { sensenova: { 1: { status: 'ok' } } }, useCfg), false)
console.log('✔ routeUnavailable')

// ── pickFallbackTarget ──
const chain = [
  { provider: 'sensenova-1', model: 'flash' },
  { provider: 'sensenova-1', model: 'glm' },
  { provider: 'sensenova-2', model: 'flash' },
  { provider: 'hcnsec-1', model: 'pro' },
  { provider: 'deepseek-official', model: 'v4' },
]
const emptyCool = new Map()
// 优先级 1:同 provider 其它 model
assert.deepEqual(
  pickFallbackTarget('sensenova-1', 'flash', chain, emptyCool, null, useCfg),
  { provider: 'sensenova-1', model: 'glm' },
)
// 优先级 2:同族其它 provider(商汤-1 glm 冷却中)
const cool2 = new Map([['sensenova-1|glm', { until: Date.now() + 100_000 }]])
assert.deepEqual(
  pickFallbackTarget('sensenova-1', 'flash', chain, cool2, null, useCfg),
  { provider: 'sensenova-2', model: 'flash' },
)
// 优先级 3:跨族(整个商汤族不可用)
const cool3 = new Map([
  ['sensenova-1|flash', { until: Date.now() + 100_000 }],
  ['sensenova-1|glm', { until: Date.now() + 100_000 }],
  ['sensenova-2|flash', { until: Date.now() + 100_000 }],
])
assert.deepEqual(
  pickFallbackTarget('sensenova-1', 'flash', chain, cool3, null, useCfg),
  { provider: 'hcnsec-1', model: 'pro' },
)
// ultimate 兜底:除末位外全冷却 → 官方仍可选
const cool4 = new Map([
  ['sensenova-1|flash', { until: Date.now() + 100_000 }],
  ['sensenova-1|glm', { until: Date.now() + 100_000 }],
  ['sensenova-2|flash', { until: Date.now() + 100_000 }],
  ['hcnsec-1|pro', { until: Date.now() + 100_000 }],
])
assert.deepEqual(
  pickFallbackTarget('sensenova-1', 'flash', chain, cool4, null, useCfg),
  { provider: 'deepseek-official', model: 'v4' },
)
// skipUltimateByUsage 时,ultimate 也参与可用性判断:
// 其它路由可用则优先选其它,不会提前落到冷却中的 ultimate
const cool5 = new Map([
  ['deepseek-official|v4', { until: Date.now() + 100_000 }],
])
assert.deepEqual(
  pickFallbackTarget('sensenova-1', 'flash', chain, cool5, null, { ...useCfg, skipUltimateByUsage: true }),
  { provider: 'sensenova-1', model: 'glm' },
)
// 即使 skipUltimateByUsage=true 且全部(含 ultimate)冷却,硬兜底仍返回链末位
const cool6 = new Map([
  ['sensenova-1|flash', { until: Date.now() + 100_000 }],
  ['sensenova-1|glm', { until: Date.now() + 100_000 }],
  ['sensenova-2|flash', { until: Date.now() + 100_000 }],
  ['hcnsec-1|pro', { until: Date.now() + 100_000 }],
  ['deepseek-official|v4', { until: Date.now() + 100_000 }],
])
assert.deepEqual(
  pickFallbackTarget('sensenova-1', 'flash', chain, cool6, null, { ...useCfg, skipUltimateByUsage: true }),
  { provider: 'deepseek-official', model: 'v4' },
)
console.log('✔ pickFallbackTarget')

// ── validateChain ──
assert.equal(validateChain(null), null)
assert.equal(validateChain('x'), null)
assert.equal(validateChain([]), null)
assert.equal(validateChain([{ provider: 'a' }]), null)
assert.deepEqual(
  validateChain([{ provider: 'a', model: 'm1' }, { bad: true }, { provider: 'b', model: 'm2' }]),
  [{ provider: 'a', model: 'm1' }, { provider: 'b', model: 'm2' }],
)
assert.deepEqual(
  validateChain([{ provider: 'sensenova-1', model: 'flash' }, { provider: 'hcnsec-1', model: 'pro' }]),
  [{ provider: 'sensenova-1', model: 'flash' }, { provider: 'hcnsec-1', model: 'pro' }],
)
console.log('✔ validateChain')

console.log('\nCORE TESTS OK')
