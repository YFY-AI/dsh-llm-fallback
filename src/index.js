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
import {
  cooldownFor,
  cooldownKey,
  displayNameOf,
  pickFallbackTarget,
  providerFamily,
  routeUnavailable,
  validateChain,
} from './core.js'

export const name = 'dsh-llm-fallback'
export const inject = ['timer', 'webServer']

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
  codes: z.array(z.string()).default(['QUOTA', 'RATE_LIMIT', 'SERVER']),
  codeLabels: z.dict(z.string()).default({
    QUOTA: '额度不足或欠费',
    RATE_LIMIT: '调用次数超限',
    SERVER: '服务端错误',
  }),
  usageFile: z.string().default(join(homedir(), '.dsh', 'plugins', 'ark-fallback', 'usage.json')),
  usageRefreshMs: z.number().default(60000),
  rateLimitCooldownMs: z.number().default(30 * 60 * 1000),
  quotaCooldownMs: z.number().default(60 * 60 * 1000),
  serverCooldownMs: z.number().default(10 * 60 * 1000),
  arkUsedPercentThreshold: z.number().default(85),
  skipUltimateByUsage: z.boolean().default(false),
  statusPath: z.string().default('/api/llm-fallback/status'),
  chainFile: z.string().default(join(homedir(), '.dsh', 'plugins', 'llm-fallback', 'chain.json')),
  sensenovaRateLimitCooldownMs: z.number().default(5 * 60 * 1000),
  stripReasoningFor: z.array(z.string()).default([
    'sensenova-1', 'sensenova-2', 'sensenova-3', 'hcnsec-1', 'hcnsec-2',
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

  const coreCfg = {
    quotaCooldownMs,
    serverCooldownMs,
    rateLimitCooldownMs,
    sensenovaRateLimitCooldownMs,
    arkThreshold,
    skipUltimateByUsage,
  }

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

  // ---- 冷却状态:cooldownKey(provider|model) -> { until, reason } ----
  const cooldowns = new Map()
  // 每 agent 一次性回退目标标记
  const pendingFallbackTarget = new WeakMap()
  // 每 agent 当前路由(展示用)
  const currentRoutes = new Map()
  // 每 agent 最近派发路由(request-error 冷却精确 model 用,payload 只带 provider)
  const lastRouteByAgent = new WeakMap()

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
    return {
      provider: route.provider,
      model: route.model,
      displayName: displayNameOf(route.provider),
      cooling: cool && cool.until > Date.now(),
      cooldownUntil: cool?.until ?? null,
      cooldownReason: cool?.reason ?? null,
      lastOkAt: out?.lastOkAt ?? null,
      lastFailAt: out?.lastFailAt ?? null,
      lastCode: out?.lastCode ?? null,
      arkPercent: usage?.ark?.['5h']?.percent ?? null,
      arkResetAt: usage?.ark?.['5h']?.reset_at ?? null,
    }
  }
  function buildStatus() {
    return {
      updated_at: Date.now(),
      chain: chain.map(providerState),
      usage: {
        ark: usage?.ark ?? null,
        updated_at: usage?.updated_at ?? null,
      },
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
        res.end(JSON.stringify(buildStatus()))
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
      const cool = cooldownForCode(failure.code, provider, fallbackModel, failure)
      cooldowns.set(cooldownKey(provider, fallbackModel), cool)
      recordFailure(provider, fallbackModel, failure.code)
      const target = pickTarget(provider, fallbackModel)
      if (target === void 0) return next()
      // 避免重试刚失败的同一路由
      if (target.provider === provider && target.model === fallbackModel) return next()
      pendingFallbackTarget.set(agent, target)
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
      // 自动跳过冷却中的渠道:用户选的 provider/model 正在冷却则重定向到链上第一个可用渠道
      if (nextConfig.provider && nextConfig.model && unavailable(nextConfig.provider, nextConfig.model)) {
        const fallback = pickTarget(nextConfig.provider, nextConfig.model)
        if (fallback && (fallback.provider !== nextConfig.provider || fallback.model !== nextConfig.model)) {
          nextConfig = { ...nextConfig, provider: fallback.provider, model: fallback.model }
        }
      }
      // 不支持 reasoning effort 的渠道去掉该字段(商汤/幻城)
      if (nextConfig.reasoningEffort && stripReasoningFor.has(nextConfig.provider)) {
        delete nextConfig.reasoningEffort
      }
      // 不在此清冷却(请求尚未发出);只更新当前渠道并记录派发路由
      recordSuccess(nextConfig.provider, nextConfig.model ?? '', payload.agent)
      lastRouteByAgent.set(payload.agent, {
        provider: nextConfig.provider,
        model: nextConfig.model ?? '',
      })
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
    disposeError()
    disposeRequest()
    disposeTimer?.()
    disposeStatusRoute()
    disposeBalance?.()
  }
}
