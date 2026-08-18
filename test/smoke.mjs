// dsh-llm-fallback 冒烟测试:用纯 cordis App 验证回替服务核心逻辑
// 运行:node test/smoke.mjs(需先 npm run build)
import assert from 'node:assert/strict'
import { App, Context } from 'cordis'
import { apply } from '../lib/index.js'

// 模拟真实 Cordis 服务注册:先注册访问器,赋值才走 setter(触发 internal/service)
function registerProvider(ctx, name, impl) {
  Context.service(name)
  ctx[name] = impl
}

async function main() {
  const app = new App()
  app.plugin({ apply }, { timeout: 500, retries: 1, circuitBreaker: { failures: 2, cooldown: 5000 } })
  await app.start()

  // 1) 服务已挂载
  assert.ok(app.llmFallback, 'ctx.llmFallback should be mounted')
  assert.equal(typeof app.llmFallback.chat, 'function')
  console.log('✔ service mounted')

  // 2) 注册两个 provider:primary 抛错,backup 成功 → 应回退到 backup
  let primaryCalls = 0
  registerProvider(app, 'primary', {
    name: 'primary',
    chat: async () => { primaryCalls++; throw new Error('primary down') },
  })
  registerProvider(app, 'backup', {
    name: 'backup',
    chat: async () => 'backup-ok',
  })
  await new Promise((r) => setTimeout(r, 20)) // 等 internal/service 事件派发

  const result = await app.llmFallback.chat([{ role: 'user', content: 'hi' }])
  assert.equal(result, 'backup-ok')
  assert.ok(primaryCalls >= 1, 'primary should have been attempted')
  console.log('✔ fallback to backup works')

  // 3) current 应指向 backup(最近成功)
  assert.equal(app.llmFallback.current?.name, 'backup')
  console.log('✔ current provider updated')

  // 4) 空 providers 时报明确错误(新建 app 验证)
  const app2 = new App()
  app2.plugin({ apply }, {})
  await app2.start()
  await assert.rejects(
    app2.llmFallback.chat([{ role: 'user', content: 'hi' }]),
    /no available provider/,
  )
  await app2.stop()
  console.log('✔ empty providers throws clear error')

  // 5) 熔断:primary 连续失败 2 次后被熔断,只有 backup 被调用
  const calls = { primary: 0, backup: 0 }
  registerProvider(app, 'primary2', {
    name: 'primary2',
    chat: async () => { calls.primary++; throw new Error('down') },
  })
  registerProvider(app, 'backup2', {
    name: 'backup2',
    chat: async () => { calls.backup++; return 'ok' },
  })
  await new Promise((r) => setTimeout(r, 20))
  // 触发熔断(primary2 失败 2 次)
  await app.llmFallback.chat([{ role: 'user', content: 'x' }]).catch(() => {})
  await app.llmFallback.chat([{ role: 'user', content: 'x' }]).catch(() => {})
  // 熔断后 primary2 不应再被调用
  const before = calls.primary
  await app.llmFallback.chat([{ role: 'user', content: 'x' }]).catch(() => {})
  assert.equal(calls.primary, before, 'tripped provider must not be called')
  console.log('✔ circuit breaker skips tripped provider')

  await app.stop()
  console.log('\nSMOKE OK')
}

main().catch((error) => {
  console.error('SMOKE FAILED:', error)
  process.exit(1)
})
