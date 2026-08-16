# dsh-llm-fallback

DSH / Cordis plugin providing **LLM provider fallback (failover)** capability.

## Install

```bash
npm i dsh-llm-fallback
```

## Usage

```ts
import { createApp } from 'cordis'
import dshLlmFallback from 'dsh-llm-fallback'

const app = createApp()
app.plugin(dshLlmFallback, {
  // 配置项见下文
})
```

## Configuration

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `providers` | `string[]` | `[]` | 优先级顺序的提供商标识（如 `['ark', 'openai', 'ollama']`） |
| `timeout` | `number` | `30000` | 单次请求超时（ms） |
| `retries` | `number` | `2` | 单提供商重试次数 |
| `healthCheck` | `boolean` | `true` | 是否启用健康探测 |

## How it works

1. 按 `providers` 顺序尝试调用
2. 单提供商失败（超时 / 错误 / 熔断）自动切换下一个
3. 可选健康探测：定期探测并维护可用列表
4. 所有调用对上层透明，统一返回标准 Cordis LLM 服务接口

## License

MIT