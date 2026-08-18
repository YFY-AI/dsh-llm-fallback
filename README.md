# dsh-llm-fallback

DeepSeek Harness LLM 回替链 + 余额查询插件

## 功能

- LLM 提供商回退机制（failover）
- 支持多个提供商按优先级切换
- 内置 DeepSeek 账户余额查询命令
- 完全兼容 Cordis 插件系统

## 安装

```bash
npm i @yfy-ai/dsh-llm-fallback --registry=https://npm.pkg.github.com/
```

## 使用

```ts
import { createApp } from 'cordis'
import dshLlmFallback from '@yfy-ai/dsh-llm-fallback'

const app = createApp()

app.plugin(dshLlmFallback, {
  providers: ['ark', 'openai', 'ollama'], // 优先级顺序
  timeout: 30000,
  retries: 2,
  healthCheck: true
})
```

## 配置选项

| 选项 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `providers` | `string[]` | `[]` | 提供商优先级列表 |
| `timeout` | `number` | `30000` | 超时时间（ms） |
| `retries` | `number` | `2` | 单提供商重试次数 |
| `healthCheck` | `boolean` | `true` | 启用健康探测 |

## 命令

- `llm-fallback balance` — 查询当前 DeepSeek 账户余额

## 开发

```bash
npm install
npm run pack
```

## License

MIT © YFY-AI
