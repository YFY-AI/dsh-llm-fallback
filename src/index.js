// dsh-llm-fallback — DSH 请求管线级多渠道自动回退(usage 感知 / 分级冷却 / 渠道族优先)
//
// 机制(对照 DSH 内部 API 验证):
//   - `agent/request-error` waterfall:`{agent, turn, step, provider, failure, retryPolicy, signal}`。
//     返回 `{ kind: "retry" }` 让 agent 循环重建请求(新的 agent/request waterfall)。
//   - `agent/request` waterfall 返回请求配置;最外层监听者(prepend: true)可覆盖路由。
//   - 无 scope 的 ctx.on 监听者接收每个 agent scope 的事件。
//   - `user/message` source {kind:"plugin", form:"notice"} 渲染为一条通知行。
//   - `ctx.webServer.register({kind, path, handler})` 提供状态 API(与 WebUI 同服务器)。

import z from '@deepseek-ai/schemastery'
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import {
  avoidTruncated,
  cooldownFor,
  cooldownKey,
  displayNameOf,
  pickFallbackTarget,
  providerFamily,
  pushWindowMetric,
  routeUnavailable,
  validateChain,
  windowSummary,
} from './core.js'

export const name = 'dsh-llm-fallback'
export const inject = ['timer', 'webServer', 'llm']

/** 一条回退链路由。 */
const routeSchema = z.object({
  provider: z.string().required(),
  model: z.string().required(),
})

/** 运行时配置(schemastery schema,与生产 mjs 一致,迁移无痛)。 */
export const Config = z.object({
  chain: z.array(routeSchema).default([
    { provider: 'volcengine-ark', model: 'deepseek-v4-flash-260801' },
    { provider: 'volcengine-ark-2', model: 'deepseek-v4-flash-260801' },
    { provider: 'hcnsec-1', model: 'DeepSeek-V4-Pro' },
    { provider: 'hcnsec-2', model: 'glm-5.2' },
    { provider: 'sensenova-1', model: 'deepseek-v4-flash' },
    { provider: 'sensenova-1', model: 'glm-5.2' },
    { provider: 'sensenova-2', model: 'deepseek-v4-flash' },
    { provider: 'sensenova-2', model: 'glm-5.2' },
    { provider: 'sensenova-3', model: 'deepseek-v4-flash' },
    { provider: 'sensenova-3', model: 'glm-5.2' },
    { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  ]),
  codes: z.array(z.string()).default(['QUOTA', 'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT']),
  codeLabels: z.dict(z.string()).default({
    QUOTA: '额度不足或欠费',
    RATE_LIMIT: '调用次数超限',
    SERVER: '服务端错误',
    MAX_TOKENS: '输出达到 token 上限',
  }),
  usageFile: z.string().default(join(homedir(), '.dsh', 'plugins', 'llm-fallback', 'usage.json')),
  usageRefreshMs: z.number().default(60000),
  rateLimitCooldownMs: z.number().default(30 * 60 * 1000),
  quotaCooldownMs: z.number().default(60 * 60 * 1000),
  serverCooldownMs: z.number().default(10 * 60 * 1000),
  arkUsedPercentThreshold: z.number().default(85),
  skipUltimateByUsage: z.boolean().default(false),
  statusPath: z.string().default('/api/llm-fallback/status'),
  chainFile: z.string().default(join(homedir(), '.dsh', 'plugins', 'llm-fallback', 'chain.json')),
  /** 渠道质量指标(成功率/延迟/截断数)持久化文件,重启不丢 */
  metricsFile: z.string().default(join(homedir(), '.dsh', 'plugins', 'llm-fallback', 'metrics.json')),
  /** 输出截断冷却:渠道被 turn/end max-tokens 标记后,此期间请求自动避让 */
  truncateCooldownMs: z.number().default(30 * 60 * 1000),
  /** 是否启用"截断自动避让"(下次请求自动切到下一可用渠道) */
  autoAvoidTruncation: z.boolean().default(true),
  sensenovaRateLimitCooldownMs: z.number().default(30 * 60 * 1000),
  stripReasoningFor: z.array(z.string()).default([
    'sensenova-1', 'sensenova-2', 'sensenova-3', 'hcnsec-1', 'hcnsec-2',
    'nexusvai',
  ]),
  // 注:schemastery 的 object 字段天然可选(zod 才需要 .optional())
  apiKey: z.string(),
})

/** 读取持久化的 chain 顺序(chainFile);缺失/损坏返回 null。 */
function loadChainFile(chainFile) {
  try {
    if (!chainFile || !existsSync(chainFile)) return null
    const raw = readFileSync(chainFile, 'utf8')
    const clean = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
    return validateChain(JSON.parse(clean))
  } catch {
    return null
  }
}

/** 写入持久化的 chain 顺序(原子:先写临时文件再 rename)。 */
function saveChainFile(chainFile, chain) {
  try {
    mkdirSync(dirname(chainFile), { recursive: true })
    const tmp = `${chainFile}.tmp`
    writeFileSync(tmp, JSON.stringify(chain, null, 2), 'utf8')
    // rename 跨设备可能失败,失败则直接写目标
    try { renameSync(tmp, chainFile) } catch { writeFileSync(chainFile, JSON.stringify(chain, null, 2), 'utf8') }
  } catch (error) {
    // 持久化失败不阻断热更新(内存已生效),仅记日志
    console.warn(`[dsh-llm-fallback] chain persist failed: ${String(error)}`)
  }
}

export function apply(ctx, config) {
  const resolved = Config['~standard'].validate(config ?? {}).value ?? {}
  // chain 可变:拖拽排序通过 POST /api/llm-fallback/chain 热更新 + 持久化到 chainFile
  let chain = resolved.chain
  {
    // 启动时优先加载 chainFile(拖拽持久化的顺序,优先级高于 config.chain)
    const saved = loadChainFile(resolved.chainFile)
    if (saved) chain = saved
  }
  // ---- 输入框模型列表精简:只显示 chain 里配置的模型 ----
  // 包装 ctx.llm.listModels,过滤掉不在 chain 中的模型(不碰内置包,卸载即恢复)。
  // 注意:chain 是 let 变量,拖拽/自动排序热更新后按最新 chain 过滤。
  const llm = ctx.llm
  if (llm && typeof llm.listModels === 'function') {
    const originalListModels = llm.listModels.bind(llm)
    llm.listModels = async (provider) => {
      const all = await originalListModels(provider)
      // chain 里该 provider 配置的模型 id 集合
      const wanted = new Set(
        chain.filter((route) => route.provider === provider).map((route) => route.model)
      )
      if (wanted.size === 0) return []
      return all.filter((model) => wanted.has(model.id))
    }
  }
  const codes = new Set(resolved.codes)
  const labels = resolved.codeLabels
  const usageFile = resolved.usageFile
  const rateLimitCooldownMs = resolved.rateLimitCooldownMs
  const quotaCooldownMs = resolved.quotaCooldownMs
  const sensenovaRateLimitCooldownMs = resolved.sensenovaRateLimitCooldownMs
  const arkThreshold = resolved.arkUsedPercentThreshold
  const skipUltimateByUsage = resolved.skipUltimateByUsage
  const statusPath = resolved.statusPath
  const stripReasoningFor = new Set(resolved.stripReasoningFor)
  const serverCooldownMs = resolved.serverCooldownMs
  const metricsFile = resolved.metricsFile

  const coreCfg = {
    quotaCooldownMs,
    serverCooldownMs,
    rateLimitCooldownMs,
    sensenovaRateLimitCooldownMs,
    arkThreshold,
    skipUltimateByUsage,
  }

  // ---- 渠道质量指标(滑动窗口)+ 切换历史 + 手动路由 ----
  // 置于 usage 块之前:refreshUsage 的"额度恢复"事件依赖 pushEvent。
  const metrics = new Map()                 // cooldownKey -> { window: [], truncatedCount }
  const routeEvents = []                    // { t, kind, ... },最多 30 条
  const requestStartBySession = new WeakMap() // session -> { at }(延迟近似基准)
  const forcedRouteBySession = new Map()    // sessionId -> { provider, model }(一次性)

  /** 取(或创建)某渠道的指标条目。 */
  function metricEntry(provider, model) {
    const key = cooldownKey(provider, model)
    let m = metrics.get(key)
    if (!m) {
      m = { window: [], truncatedCount: 0 }
      metrics.set(key, m)
    }
    return m
  }

  /** 记录一次请求结果(成功/失败 + 延迟),窗口持久化由 saveMetrics 防抖。 */
  function recordResult(provider, model, ok, latencyMs) {
    const m = metricEntry(provider, model)
    m.window = pushWindowMetric(m.window, ok, latencyMs)
    saveMetrics()
  }

  /** 追加一条切换历史(内存,最多 30 条)。 */
  function pushEvent(ev) {
    routeEvents.push({ t: Date.now(), ...ev })
    if (routeEvents.length > 30) routeEvents.splice(0, routeEvents.length - 30)
  }

  /** 立即把 metrics 写盘(原子:tmp + rename)。 */
  function flushMetricsNow() {
    try {
      const obj = {}
      for (const [k, v] of metrics) obj[k] = { window: v.window, truncatedCount: v.truncatedCount }
      mkdirSync(dirname(metricsFile), { recursive: true })
      const tmp = `${metricsFile}.tmp`
      writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8')
      try { renameSync(tmp, metricsFile) } catch { writeFileSync(metricsFile, JSON.stringify(obj, null, 2), 'utf8') }
    } catch (error) {
      console.warn(`[dsh-llm-fallback] metrics persist failed: ${String(error)}`)
    }
  }

  /** 防抖写盘(高频记录时合并,2s 内最后一次生效)。 */
  let metricsSaveTimer = null
  function saveMetrics() {
    if (metricsSaveTimer) clearTimeout(metricsSaveTimer)
    metricsSaveTimer = setTimeout(() => {
      metricsSaveTimer = null
      flushMetricsNow()
    }, 2000)
  }

  /** 启动时恢复历史指标(损坏/缺失忽略)。 */
  function loadMetrics() {
    try {
      if (!existsSync(metricsFile)) return
      const raw = readFileSync(metricsFile, 'utf8')
      const clean = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
      const data = JSON.parse(clean)
      if (data && typeof data === 'object') {
        for (const [k, v] of Object.entries(data)) {
          if (v && Array.isArray(v.window)) {
            metrics.set(k, {
              window: v.window,
              truncatedCount: Number.isFinite(v.truncatedCount) ? v.truncatedCount : 0,
            })
          }
        }
      }
    } catch { /* 损坏忽略,从空开始 */ }
  }
  loadMetrics()

  // ---- usage 快照(火山方舟 plan 窗口,零 token) ----
  let usage = null
  const prevArkPct = { '5h': null, weekly: null, monthly: null }
  function refreshUsage() {
    try {
      if (!existsSync(usageFile)) return
      const raw = readFileSync(usageFile, 'utf8')
      const clean = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
      usage = JSON.parse(clean)
      // 零 token 恢复:任一方舟窗口从近耗尽(>=90%)掉回舒适(<80%)视为额度重置
      const ark = usage?.ark
      if (ark) {
        for (const label of ['5h', 'weekly', 'monthly']) {
          const w = ark[label]
          if (!w || typeof w.percent !== 'number') continue
          const prev = prevArkPct[label]
          if (prev !== null && prev >= 90 && w.percent < 80) {
            for (const p of ['volcengine-ark', 'volcengine-ark-2']) {
              cooldowns.delete(p)
            }
            pushEvent({ kind: 'recover', provider: 'volcengine-ark', note: `方舟 ${label} 用量回落至 ${w.percent}%` })
          }
          prevArkPct[label] = w.percent
        }
      }
    } catch (error) {
      usage = null
    }
  }
  refreshUsage()
  const disposeTimer = ctx.setInterval?.(refreshUsage, resolved.usageRefreshMs)

  // ---- 每5分钟调用 PowerShell 脚本更新 usage.json (替代 Windows 计划任务,无弹窗) ----
  const monitorScript = join(homedir(), '.dsh', 'plugins', 'llm-fallback', 'monitor-usage.ps1')
  function updateUsageFile() {
    try {
      if (!existsSync(monitorScript)) return
      execFile('powershell.exe', [
        '-NoLogo', '-NoProfile', '-NonInteractive',
        '-WindowStyle', 'Hidden',
        '-ExecutionPolicy', 'Bypass',
        '-File', monitorScript,
        '-UsageFile', usageFile,
      ], { timeout: 30000 }, (error) => {
        if (error) {
          ctx.logger?.warn?.(`[dsh-llm-fallback] usage update failed: ${error.message}`)
        } else {
          ctx.logger?.info?.('[dsh-llm-fallback] usage.json refreshed (zero-token)')
        }
      })
    } catch (error) {
      ctx.logger?.warn?.(`[dsh-llm-fallback] updateUsageFile error: ${error.message}`)
    }
  }
  updateUsageFile() // 启动时立即刷新一次
  const disposeUpdateTimer = ctx.setInterval?.(updateUsageFile, 5 * 60 * 1000)

  // ---- 冷却状态:cooldownKey(provider|model) -> { until, reason } ----
  const cooldowns = new Map()
  // 每 agent 一次性回退目标标记
  const pendingFallbackTarget = new WeakMap()
  // 每 agent 当前路由(展示用)
  const currentRoutes = new Map()
  // 每 agent 最近派发路由(request-error 冷却精确 model 用,payload 只带 provider)
  const lastRouteByAgent = new WeakMap()
  // 每 session 最近派发路由(turn/end max-tokens 用,session/event 只有 session 无 agent)
  const lastRouteBySession = new WeakMap()
  // 每 sessionId 当前路由(实时展示用,status?sessionId= 返回;key 为 sessionId 字符串)
  const currentRouteBySessionId = new Map()
  // 截断冷却:cooldownKey(provider|model) -> until(turn/end max-tokens 时记录)
  const truncated = new Map()

  // 监听轮次结束:① 质量指标(成功/截断 + 延迟)② 截断时记录渠道,后续请求自动避让
  const disposeTurnEnd = ctx.on('session/event', (subject, event) => {
    if (event?.type !== 'turn/end') return
    const reason = event.data?.reason
    const route = lastRouteBySession.get(subject)
    // ① 质量指标:轮次正常结束 = 请求成功(截断也算完成,单独计截断数)
    if (route?.provider) {
      const startAt = requestStartBySession.get(subject)?.at
      const latency = startAt ? Date.now() - startAt : null
      recordResult(route.provider, route.model, true, latency)
      if (reason?.kind === 'max-tokens') {
        metricEntry(route.provider, route.model).truncatedCount++
        saveMetrics()
        pushEvent({ kind: 'truncated', provider: route.provider, model: route.model })
      }
    }
    // ② 截断避让(仅当开启):标记渠道,下次请求自动切换
    if (!resolved.autoAvoidTruncation) return
    if (reason?.kind !== 'max-tokens') return
    if (!route?.provider) return
    const until = Date.now() + resolved.truncateCooldownMs
    truncated.set(cooldownKey(route.provider, route.model), until)
    pushEvent({ kind: 'avoid', provider: route.provider, model: route.model, note: `截断避让 ${Math.round(resolved.truncateCooldownMs / 60000)}min` })
    ctx.logger?.info?.(
      `[dsh-llm-fallback] ${displayNameOf(route.provider)} ${route.model} hit output token cap; will avoid for ${Math.round(resolved.truncateCooldownMs / 60000)}min`,
    )
  })

  function cooldownForCode(code, provider, model, failure) {
    return cooldownFor(code, provider, model, failure, coreCfg, usage)
  }

  function unavailable(provider, model) {
    return routeUnavailable(provider, model, cooldowns, usage, coreCfg)
  }

  function pickTarget(skipProvider, skipModel) {
    return pickFallbackTarget(skipProvider, skipModel, chain, cooldowns, usage, coreCfg)
  }

  // ---- UI 通知:切换时以 notice 行告知用户 ----
  function appendNotice(agent, code, sourceProvider, targetRoute, reason) {
    const why = reason ? `（依据：${reason}）` : ''
    const sourceName = displayNameOf(sourceProvider)
    const targetName = displayNameOf(targetRoute.provider)
    const summary = `${targetName}（${sourceName}）${why}`
    const text = `[系统提示] ${labels[code] ?? code}（${sourceName}），当前步骤已自动切换到 ${targetRoute.model}（${targetName}）${why}继续执行。`
    try {
      const message = {
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text }],
        source: {
          kind: 'plugin',
          plugin: 'dsh-llm-fallback',
          form: 'notice',
          summary,
        },
      }
      agent.session.append('user/message', message, { surfaceOp: 'append' })
    } catch (error) {
      ctx.logger?.warn?.(`dsh-llm-fallback: notice append failed: ${String(error)}`)
    }
  }

  // ---- 被动结果追踪 ----
  // recordSuccess 只更新展示状态,绝不能清冷却:冷却由 request-error 设置,
  // 仅靠到期或 usage 恢复释放——在请求构建期清冷却会导致 ①↔② 循环。
  const outcomes = new Map() // provider -> { lastOkAt, lastFailAt, lastCode }
  /** 取 session 对象的稳定 id(字符串),供 status?sessionId= 反查当前路由。 */
  function sessionIdOf(session) {
    return session?.sid ?? session?.id ?? null
  }
  function recordSuccess(provider, model, agent) {
    outcomes.set(provider, { ...(outcomes.get(provider) ?? {}), lastOkAt: Date.now(), lastCode: void 0 })
    if (agent) {
      currentRoutes.set(agent, { provider, model, since: Date.now() })
    }
  }
  function recordFailure(provider, model, code) {
    outcomes.set(provider, { ...(outcomes.get(provider) ?? {}), lastFailAt: Date.now(), lastCode: code })
  }

  // ---- 状态 API ----
  function providerState(route) {
    const cool = cooldowns.get(cooldownKey(route.provider, route.model))
    const out = outcomes.get(route.provider)
    const trunc = truncated.get(cooldownKey(route.provider, route.model))
    const m = metrics.get(cooldownKey(route.provider, route.model))
    const s = windowSummary(m?.window)
    return {
      provider: route.provider,
      model: route.model,
      displayName: displayNameOf(route.provider),
      cooling: cool && cool.until > Date.now(),
      cooldownUntil: cool?.until ?? null,
      cooldownReason: cool?.reason ?? null,
      truncated: trunc !== undefined && trunc > Date.now(),
      truncatedUntil: trunc ?? null,
      lastOkAt: out?.lastOkAt ?? null,
      lastFailAt: out?.lastFailAt ?? null,
      lastCode: out?.lastCode ?? null,
      arkPercent: usage?.ark?.['5h']?.percent ?? null,
      arkResetAt: usage?.ark?.['5h']?.reset_at ?? null,
      // 质量指标(最近 20 次滑动窗口)
      successRate: s.rate,
      okCount: s.okCount,
      failCount: s.failCount,
      avgLatencyMs: s.avgLatencyMs,
      truncatedCount: m?.truncatedCount ?? 0,
    }
  }
  function buildStatus(sessionId) {
    const current = sessionId ? (currentRouteBySessionId.get(sessionId) ?? null) : null
    return {
      updated_at: Date.now(),
      chain: chain.map(providerState),
      current,
      usage: {
        ark: usage?.ark ?? null,
        updated_at: usage?.updated_at ?? null,
      },
      events: routeEvents.slice(-20),
    }
  }

  let disposeStatusRoute = () => {}
  try {
    const webServer = ctx.webServer
    disposeStatusRoute = webServer.register({
      kind: 'exact',
      path: statusPath,
      handler: (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        const u = new URL(req.url, 'http://dsh.local')
        const sessionId = u.searchParams.get('sessionId')
        res.end(JSON.stringify(buildStatus(sessionId)))
      },
    })
    // POST /api/llm-fallback/chain — 拖拽排序热更新(内存立即生效 + 持久化 chainFile)
    disposeStatusRoute = webServer.register({
      kind: 'exact',
      path: '/api/llm-fallback/chain',
      handler: (req, res) => {
        let body = ''
        req.on('data', (chunk) => { body += chunk })
        req.on('end', () => {
          const send = (status, obj) => {
            res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
            res.end(JSON.stringify(obj))
          }
          let parsed
          try { parsed = JSON.parse(body || '{}') } catch { return send(400, { ok: false, error: 'invalid json' }) }
          const next = validateChain(parsed?.chain)
          if (!next) return send(400, { ok: false, error: 'chain must be a non-empty array of {provider, model}' })
          chain = next // 热更新:回退逻辑立即按新顺序
          saveChainFile(resolved.chainFile, next)
          send(200, { ok: true, chain })
        })
      },
    })
    // POST /api/llm-fallback/route — 手动"用此渠道":下一次请求强制路由到指定渠道
    // (per-session 一次性;仅校验路由在 chain 内,不做冷却拦截——用户明确选择优先)
    disposeStatusRoute = webServer.register({
      kind: 'exact',
      path: '/api/llm-fallback/route',
      handler: (req, res) => {
        let body = ''
        req.on('data', (chunk) => { body += chunk })
        req.on('end', () => {
          const send = (status, obj) => {
            res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
            res.end(JSON.stringify(obj))
          }
          let parsed
          try { parsed = JSON.parse(body || '{}') } catch { return send(400, { ok: false, error: 'invalid json' }) }
          const { provider, model, sessionId } = parsed ?? {}
          if (typeof provider !== 'string' || typeof model !== 'string' || typeof sessionId !== 'string') {
            return send(400, { ok: false, error: 'provider/model/sessionId required' })
          }
          if (!chain.some((r) => r.provider === provider && r.model === model)) {
            return send(400, { ok: false, error: 'route not in chain' })
          }
          forcedRouteBySession.set(sessionId, { provider, model })
          pushEvent({ kind: 'manual', provider, model })
          send(200, { ok: true, provider, model })
        })
      },
    })
  } catch (error) {
    ctx.logger?.warn?.(`dsh-llm-fallback: status route failed: ${String(error)}`)
  }

  // ---- 事件监听 ----
  const disposeError = ctx.on(
    'agent/request-error',
    async (payload, next) => {
      const { agent, provider, failure } = payload
      if (failure?.code === void 0 || !codes.has(failure.code)) return next()
      // request-error payload 不带 model;从该 agent 最近派发路由恢复精确 model
      const last = lastRouteByAgent.get(agent)
      const failedModel = last && last.provider === provider ? last.model : void 0
      const fallbackModel = failedModel ?? chain.find((route) => route.provider === provider)?.model
      if (fallbackModel === void 0) return next()
      let cool = cooldownForCode(failure.code, provider, fallbackModel, failure)
      // 连续 RATE_LIMIT 升级: 同一渠道已在"限流冷却"中,再次 RATE_LIMIT 说明是额度耗尽,升级为 QUOTA 冷却
      if (cool.reason !== '上游指定重试时间' && failure.code === 'RATE_LIMIT') {
        const key = cooldownKey(provider, fallbackModel)
        const existing = cooldowns.get(key)
        if (existing && existing.until > Date.now() && existing.reason === '限流冷却') {
          cool = { until: Date.now() + quotaCooldownMs, reason: '连续限流升级(额度耗尽)' }
        }
      }
      cooldowns.set(cooldownKey(provider, fallbackModel), cool)
      recordFailure(provider, fallbackModel, failure.code)
      // 质量指标:失败 + 延迟(近似 = 请求派发到失败)
      const startAt = requestStartBySession.get(agent.session)?.at
      recordResult(provider, fallbackModel, false, startAt ? Date.now() - startAt : null)
      const target = pickTarget(provider, fallbackModel)
      if (target === void 0) return next()
      // 避免重试刚失败的同一路由
      if (target.provider === provider && target.model === fallbackModel) return next()
      pendingFallbackTarget.set(agent, target)
      pushEvent({ kind: 'fallback', from: provider, model: fallbackModel, to: target.provider, targetModel: target.model, reason: cool.reason })
      appendNotice(agent, failure.code, provider, target, cool.reason)
      return { kind: 'retry' }
    },
    { prepend: true },
  )

  const disposeRequest = ctx.on(
    'agent/request',
    async (payload, next) => {
      const resolved = await next()
      const target = pendingFallbackTarget.get(payload.agent)
      let nextConfig
      if (target !== void 0) {
        pendingFallbackTarget.delete(payload.agent)
        nextConfig = { ...resolved, provider: target.provider, model: target.model }
      } else {
        nextConfig = { ...resolved }
      }
      // 手动"用此渠道":一次性强制路由(侧边栏按钮),最高优先,跳过自动冷却/截断避让
      // 注意:forcedRouteBySession 以字符串 sessionId 为 key(POST /route 写入),
      // 此处必须用 sessionIdOf() 把 session 对象转成同款字符串 key,否则对象≠字符串永远取不到
      const forcedSid = sessionIdOf(payload.agent.session)
      const forced = forcedSid ? forcedRouteBySession.get(forcedSid) : void 0
      if (forced && forced.provider && forced.model) {
        forcedRouteBySession.delete(forcedSid)
        nextConfig = { ...nextConfig, provider: forced.provider, model: forced.model }
      } else {
        // 自动跳过冷却中的渠道:用户选的 provider/model 正在冷却则重定向到链上第一个可用渠道
        if (nextConfig.provider && nextConfig.model && unavailable(nextConfig.provider, nextConfig.model)) {
          const fallback = pickTarget(nextConfig.provider, nextConfig.model)
          if (fallback && (fallback.provider !== nextConfig.provider || fallback.model !== nextConfig.model)) {
            nextConfig = { ...nextConfig, provider: fallback.provider, model: fallback.model }
          }
        }
        // 截断避让:当前渠道在截断冷却内(上轮 max-tokens 截断)自动切下一可用渠道
        if (resolved.autoAvoidTruncation && nextConfig.provider && nextConfig.model) {
          const alt = avoidTruncated(nextConfig.provider, nextConfig.model, chain, cooldowns, truncated, coreCfg)
          if (alt && (alt.provider !== nextConfig.provider || alt.model !== nextConfig.model)) {
            const from = `${displayNameOf(nextConfig.provider)} ${nextConfig.model}`
            nextConfig = { ...nextConfig, provider: alt.provider, model: alt.model }
            try {
              appendNotice(payload.agent, 'MAX_TOKENS', nextConfig.provider, alt, `上轮输出截断(${from})`)
            } catch { /* notice 失败不阻断 */ }
          }
        }
      }
      // 不支持 reasoning effort 的渠道(nexusvai 等 proxy / 商汤 / 幻城)去掉该字段,否则下游拒接
      if (nextConfig.reasoningEffort && stripReasoningFor.has(nextConfig.provider)) {
        delete nextConfig.reasoningEffort
      }
      // 不在此清冷却(请求尚未发出);记录派发时间(延迟近似基准)+ 当前渠道
      requestStartBySession.set(payload.agent.session, { at: Date.now() })
      recordSuccess(nextConfig.provider, nextConfig.model ?? '', payload.agent)
      lastRouteByAgent.set(payload.agent, {
        provider: nextConfig.provider,
        model: nextConfig.model ?? '',
      })
      lastRouteBySession.set(payload.agent.session, {
        provider: nextConfig.provider,
        model: nextConfig.model ?? '',
      })
      // 实时"当前"路由:按 sessionId 记录,status?sessionId= 读取
      const sid = sessionIdOf(payload.agent.session)
      if (sid) {
        currentRouteBySessionId.set(sid, {
          provider: nextConfig.provider,
          model: nextConfig.model ?? '',
        })
      }
      return nextConfig
    },
    { prepend: true },
  )

  // ---- balance 命令(附加能力,独立于回退链) ----
  let disposeBalance = () => {}
  const commands = ctx.get?.('commands') ?? ctx.commands
  if (commands?.register) {
    disposeBalance = commands.register({
      name: 'llm-fallback-balance',
      description: '查询当前 DeepSeek 账户余额',
      handler: async (invocation) => {
        const apiKey = resolved.apiKey ?? process.env.DEEPSEEK_API_KEY
        if (!apiKey) {
          return { kind: 'error', text: '未配置 DeepSeek API Key:插件配置 apiKey 或环境变量 DEEPSEEK_API_KEY' }
        }
        try {
          const res = await fetch('https://api.deepseek.com/user/balance', {
            method: 'GET',
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: invocation.signal,
          })
          if (!res.ok) return { kind: 'error', text: `余额查询失败:HTTP ${res.status}` }
          const data = await res.json()
          const info = data?.balance_infos?.[0]
          if (!info) return { kind: 'error', text: '余额查询失败:响应格式异常' }
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
          ].join('\n')
          return { kind: 'success', text }
        } catch (error) {
          if (invocation.signal.aborted) return { kind: 'error', text: '查询已取消' }
          return { kind: 'error', text: `余额查询失败:${error instanceof Error ? error.message : String(error)}` }
        }
      },
    })
  }

  return () => {
    if (metricsSaveTimer) {
      clearTimeout(metricsSaveTimer)
      metricsSaveTimer = null
    }
    flushMetricsNow() // 卸载时立即落盘(清空防抖)
    disposeError()
    disposeRequest()
    disposeTurnEnd()
    disposeTimer?.()
    disposeUpdateTimer?.()
    disposeStatusRoute()
    disposeBalance?.()
  }
}
