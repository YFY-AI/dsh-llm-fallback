# dsh-llm-fallback

**DSH 请求管线级多渠道自动回退** — 适配官方 GUI 版与第三方桌面版

在 DSH 的 `agent/request` 管线层面工作:任一渠道触发 `QUOTA` / `RATE_LIMIT` / `SERVER` 时,当前步骤自动重试到链上第一个可用渠道,并对用户显示一条切换通知。例如:

```
[系统提示] 额度不足或欠费（DeepSeek 官方），当前步骤已自动切换到 claude-opus-4.8-free（nexusvai）（依据：额度重置）继续执行。
```

## 功能

- **证据驱动回退**:失败码触发重试,按优先级选链上「既未冷却又未被 usage 标记不可用」的首个路由;链末位(DeepSeek 官方)永远兜底,真实失败不会被吞成死循环
- **严格链序回退**:chain 顺序即完整回退优先级,每次失败后从链首扫描第一个「可用且非刚失败路由」;拖拽排序即全局重排。链末位(DeepSeek 官方)永远兜底,真实失败不吞成死循环
- **零 Token 被动监测**:商汤可用性从真实请求结果推断(成功清冷却、触发码失败设冷却),火山方舟额度来自控制面 plan 快照(`tools/monitor-usage.ps1`,不耗推理 Token)
- **分级冷却**:QUOTA(至额度重置)/ RATE_LIMIT(商汤短冷却 5min,其余 30min)/ SERVER(短冷却 10min);上游 `providerRetryAfterMs` 优先
- **自动跳过冷却渠道**:用户手动选的 provider/model 正在冷却时,请求自动重定向到首个可用渠道
- **输出截断避让(v0.7.0)**:某渠道 `turn/end` 达到输出 token 上限后进入截断冷却(默认 30min,可配 `truncateCooldownMs`),**下一次请求(包括用户点"继续")自动切到下一可用渠道**,避免反复截断;侧边栏显示「截断」标记
- **`stripReasoningFor`**:商汤/幻城等不支持 reasoning effort 的渠道自动去掉该字段
- **侧边栏「模型渠道」Tab**(需 `dsh-better-sidebar`):卡片式渠道状态,支持拖拽排序、冷却倒计时、截断标记、方舟用量条;**官方 GUI 版与第三方桌面版均可使用**
- **命令**:`/llm-fallback-balance` 查询 DeepSeek 账户余额
- **状态 API**:`GET /api/llm-fallback/status`(JSON,供侧边栏与外部消费)

## 安装

```bash
npm i @yfy-ai/dsh-llm-fallback --registry=https://npm.pkg.github.com/
```

本插件适配官方 GUI 版与第三方桌面版。在 DSH 插件配置(`~/.dsh/profiles/<profile>/cordis.patch.yml`)启用:

```yaml
- insert:
    - id: dsh-llm-fallback
      name: '@yfy-ai/dsh-llm-fallback'
      config:
        chain:
          - provider: volcengine-ark
            model: deepseek-v4-flash-260801
          - provider: hcnsec-1
            model: DeepSeek-V4-Pro
          - provider: sensenova-1
            model: deepseek-v4-flash
          - provider: deepseek-official
            model: deepseek-v4-flash
        codes: [QUOTA, RATE_LIMIT, SERVER]
```

> **第三方桌面版用户**:`cordis.patch.yml` 位于 `~/.dsh/profiles/web-desktop/`(与官方 GUI 版共享同一配置结构,chain 等字段完全兼容)。侧边栏「模型渠道」Tab 在桌面版 Better-Sidebar 中同样自动打开,所有功能一致。

## 配置选项

| 选项 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `chain` | `[{provider, model}]` | 见源码 | 回退链(按优先级;末位为 ultimate 兜底) |
| `codes` | `string[]` | `[QUOTA, RATE_LIMIT, SERVER, TIMEOUT, TRANSPORT]` | 触发回退的失败码 |
| `codeLabels` | `dict` | 中文标签 | 通知文案 |
| `usageFile` | `string` | `~/.dsh/plugins/llm-fallback/usage.json` | usage 快照路径(monitor-usage.ps1 产出) |
| `usageRefreshMs` | `number` | `60000` | usage 刷新间隔 |
| `rateLimitCooldownMs` | `number` | `30min` | RATE_LIMIT 冷却(非商汤) |
| `quotaCooldownMs` | `number` | `60min` | QUOTA 冷却(无重置时间时) |
| `serverCooldownMs` | `number` | `10min` | SERVER 冷却 |
| `sensenovaRateLimitCooldownMs` | `number` | `5min` | 商汤 RATE_LIMIT 冷却(短时限流) |
| `arkUsedPercentThreshold` | `number` | `85` | 方舟 5h 用量超此百分比视为不可用 |
| `skipUltimateByUsage` | `boolean` | `false` | ultimate 路由是否也受可用性约束 |
| `stripReasoningFor` | `string[]` | 商汤/幻城 | 自动去掉 reasoning effort 的渠道 |
| `statusPath` | `string` | `/api/llm-fallback/status` | 状态 API 路径 |
| `chainFile` | `string` | `~/.dsh/plugins/llm-fallback/chain.json` | 拖拽排序持久化文件(优先级高于 config.chain) |
| `truncateCooldownMs` | `number` | `30min` | 输出截断冷却:渠道被截断后此期间自动避让 |
| `autoAvoidTruncation` | `boolean` | `true` | 启用截断自动避让(下次请求自动切下一可用渠道) |
| `apiKey` | `string` | - | 余额查询 key(默认读 `DEEPSEEK_API_KEY`) |

## 侧边栏「模型渠道」Tab

安装 `dsh-better-sidebar` 后,插件会在侧边栏注册「模型渠道」Tab 并自动打开(**官方 GUI 版与第三方桌面版均支持**):

- **卡片式布局**:渠道族分组(火山方舟/商汤/幻城/DeepSeek),全部使用 DSH 主题变量(`--dsw-alias-*`),**自动适配所有皮肤**
- **当前渠道**:顶部胶囊显示当前优先渠道 + 状态点
- **拖拽排序**:拖动 `⋮⋮` 手柄调整回退优先级 → `POST /api/llm-fallback/chain` **热生效**(回退立即按新顺序)+ 持久化到 `chain.json`
- **冷却倒计时**:熔断渠道实时显示剩余时间(1s 刷新)
- **截断标记**:输出 token 达到上限的渠道自动标记「截断」,后续请求自动避让
- **用量条**:方舟 5h 用量进度条(≥85% 红 / ≥60% 黄 / 绿)
- 数据通道:`GET /api/llm-fallback/status`(10s 轮询)

### 顺序持久化(chain.json)

拖拽后的新顺序写入 `~/.dsh/plugins/llm-fallback/chain.json`(可配 `chainFile`),**优先级高于 cordis.patch.yml 的 `chain` 字段**;启动时自动加载,重启保留。删除该文件即回到配置文件里的顺序。

### 热重载说明

| 操作 | 是否重启 |
|------|----------|
| 拖拽调整顺序 / 修改配置 | ✅ 热生效,零重启(走 API) |
| 改 client 代码(Tab UI) | ✅ 刷新浏览器页面即可(不用重启 dsh we;第三方桌面版按 `Ctrl+R` 刷新) |
| 改 host 代码(回退逻辑) | ⚠️ 需重启 dsh web / 第三方桌面版,或 DSH 官方 `cordis_run mode:"update"` 热激活 |

## 工作示例

插件在渠道切换时以系统通知形式告知用户,以下是实际运行中的通知示例:

> `[系统提示] 额度不足或欠费(DeepSeek 官方),当前步骤已自动切换到 claude-opus-4.8-free(nexusvai)(依据:额度重置)继续执行。`

> `[系统提示] 调用次数超限(商汤日日新①),当前步骤已自动切换到 glm-5.2(商汤日日新①)(依据:短时限流)继续执行。`

> `[系统提示] 调用次数超限(商汤日日新①),当前步骤已自动切换到 deepseek-v4-flash(商汤日日新②)(依据:短时限流)继续执行。`

通知文案包含:失败码(QUOTA / RATE_LIMIT / SERVER)、失败渠道、目标渠道、切换依据(冷却原因)。侧边栏「模型渠道」Tab 同步显示各渠道的冷却/截断/用量状态。

## 用量监测(火山方舟,零 Token)

`tools/monitor-usage.ps1` 从控制面拉取套餐额度写入 usage.json(不探测任何模型):

```powershell
# 手动执行,或加入计划任务每 ~5 分钟一次
powershell -File node_modules/@yfy-ai/dsh-llm-fallback/tools/monitor-usage.ps1
```

## 从旧本地插件迁移

本机旧版是 profile 本地文件(`./plugins/dsh-llm-fallback.mjs`)+ 独立 widget(`dsh-client-ui-ark-status`)。迁移到发布版:

1. `cordis.patch.yml` 中把 `name: ./plugins/dsh-llm-fallback.mjs` 改为 `name: '@yfy-ai/dsh-llm-fallback'`(config 的 `chain` 等结构**无需修改**,schema 完全一致)
2. **删除** `dsh-client-ui-ark-status` 的 insert 条目(侧边栏 Tab 已内置,重复注册会冲突)
3. 重启 `dsh web`(或 第三方桌面版完全退出后重新打开)
4. (可选)删除旧文件 `~/.dsh/profiles/<profile>/plugins/dsh-llm-fallback.mjs`

> 第三方桌面版用户的 `cordis.patch.yml` 位于 `~/.dsh/profiles/web-desktop/`,迁移步骤完全相同。

## 架构

```
src/
├── index.js    # 入口:agent/request + agent/request-error 监听、usage/冷却/截断状态、状态 API、balance 命令
└── core.js     # 纯函数:渠道族 / 冷却计算 / 路由选择 / 截断避让(可独立测试)
client/
└── client.js   # 侧边栏「模型渠道」Tab(DSH __ModuleLoader__ bundle,10s 轮询状态 API)
tools/
└── monitor-usage.ps1   # 火山方舟用量监测(零 Token)
test/
└── core.test.mjs       # core.js 纯函数单元测试(8 组)
```

所有功能同时适配官方 GUI 版与第三方桌面版,零配置差异。

## 开发

```bash
npm install
npm run build   # 复制 src/*.js → lib/,client → lib/
npm test        # core.js 单元测试
npm run pack
```

## License

MIT © YFY-AI

---

*适配官方 GUI 版与第三方桌面版,零配置差异。*
