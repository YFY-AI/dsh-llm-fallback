# dsh-llm-fallback

DeepSeek Harness LLM 回替链 + 余额查询插件

## 功能

- **LLM 提供商回退链(failover)**:按优先级依次调用,失败自动切换下一个
- **真实超时**:AbortSignal 传导到 provider 调用,超时即中断
- **健康探测 + 熔断**:周期探测维护健康状态,连续失败自动熔断冷却
- **DSH 命令**:
  - `/llm-fallback-balance` — 查询 DeepSeek 账户余额
  - `/llm-fallback-status` — 查看回替链状态(当前 provider / 健康 / 熔断)
- **侧边栏「回替链」Tab**(需已装 `dsh-better-sidebar`):实时显示当前渠道与各 provider 健康/延迟/熔断状态,SSE 事件推送即时刷新

## 安装

```bash
npm i @yfy-ai/dsh-llm-fallback --registry=https://npm.pkg.github.com/
```

在 DSH 插件配置(cordis.patch.yml)中启用:

```yaml
plugins:
  - name: '@yfy-ai/dsh-llm-fallback'
    config:
      providers: ['ark', 'openai', 'ollama']   # 优先级白名单(可选)
      timeout: 30000
      retries: 2
      healthCheck: true
      healthCheckInterval: 60000
      circuitBreaker:
        failures: 3
        cooldown: 30000
      apiKey: ''   # 余额查询 API key(可选,默认读 DEEPSEEK_API_KEY 环境变量)
```

## 作为 Cordis 插件使用

```ts
import { createApp } from 'cordis'
import { apply } from '@yfy-ai/dsh-llm-fallback'

const app = createApp()
app.plugin({ apply }, {
  providers: ['ark', 'openai', 'ollama'],
  timeout: 30000,
  retries: 2,
  healthCheck: true,
})
await app.start()

// 注册任意带 chat() 的服务即可被自动跟踪(支持运行时动态注册)
app.llm = {
  name: 'ollama',
  chat: async (messages, options) => { /* ... */ },
  healthCheck: async () => true,
}

// 回替调用
const result = await app.llmFallback.chat([{ role: 'user', content: 'hi' }])
```

## 配置选项

| 选项 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `providers` | `string[]` | `[]` | 优先级白名单;空数组 = 自动发现所有带 chat() 的服务 |
| `timeout` | `number` | `30000` | 单次调用超时(ms),AbortSignal 真实传导 |
| `retries` | `number` | `2` | 单 provider 连续重试次数 |
| `healthCheck` | `boolean` | `true` | 启用周期健康探测 |
| `healthCheckInterval` | `number` | `60000` | 健康探测间隔(ms) |
| `circuitBreaker.failures` | `number` | `3` | 连续失败熔断阈值 |
| `circuitBreaker.cooldown` | `number` | `30000` | 熔断冷却时长(ms) |
| `apiKey` | `string` | - | 余额查询 key(默认读 `DEEPSEEK_API_KEY`) |

## 侧边栏「回替链」Tab

安装 `dsh-better-sidebar` 后,插件会在侧边栏注册「🔀 回替链」Tab 并自动打开:

- **当前渠道**:回替链当前优先的 provider(最近成功者)
- **状态表**:各 provider 健康 / 延迟 / 熔断状态
- **数据通道**:host 提供 `GET /api/llm-fallback/snapshot`(初始快照)与 `GET /api/llm-fallback/events`(SSE 事件推送),provider 切换、失败、熔断、恢复时即时刷新,无需轮询

## 开发

```bash
npm install
npm run build      # tsc → lib/
npm test           # cordis App 冒烟测试(构建后)
npm run pack
```

## 架构

```
src/
├── index.ts        # 插件入口:挂载 ctx.llmFallback + 注册 DSH 命令 + SSE/snapshot 端点
├── host.ts         # LlmFallbackService:回替/超时/健康/熔断核心(含事件订阅)
├── types.ts        # LlmMessage / LlmProvider / ProviderHealth
└── commands/
    ├── balance.ts  # /llm-fallback-balance
    └── status.ts   # /llm-fallback-status
client/
└── client.js       # 侧边栏「回替链」Tab(DSH __ModuleLoader__ bundle,SSE 实时刷新)
scripts/
└── copy-client.mjs # 构建时把 client bundle 复制到 lib/
```

Provider 以"鸭子类型"识别:任何带 `name` + `chat()` 的服务(经 `ctx[name] = value` 赋值)都会被 `internal/service` 事件自动跟踪。

## License

MIT © YFY-AI
