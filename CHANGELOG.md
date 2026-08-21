# Changelog

本文件记录 `@yfy-ai/dsh-llm-fallback` 的所有重要变更。格式参考 [Keep a Changelog](https://keepachangelog.com/)，版本号遵循语义化版本。

## [0.8.7] - 2026-08-21

> 修复版本。

### 修复
- `src/index.js`：修复切换模型/渠道到 `nexusvai` 等不支持 `reasoning effort` 的 provider 时，请求仍携带 `reasoningEffort: "high"` 被下游拒接的 BUG（`provider "nexusvai" model "claude-opus-4.8-free" does not support reasoning effort "high"`）。将 `nexusvai` 加入 `stripReasoningFor` 默认黑名单（`sensenova-*` / `hcnsec-*` 之外），路由到该 provider 时自动剥离 `reasoningEffort`，覆盖 fallback / 手动强制切换 / 直接选为主渠道三种场景。
- 更新剥离逻辑注释，准确说明适用范围（proxy / 商汤 / 幻城类渠道）。

## [0.8.6] - 2026-08-19

> CI 升级版本，无功能变更。

### CI
- `.github/workflows/release.yml`：`softprops/action-gh-release@v2` → `@v3`（v3 运行时为 Node 24，消除最后一条 Node 20 弃用告警）。

## [0.8.5] - 2026-08-19

> CI 升级版本，无功能变更。

### CI
- `.github/workflows/release.yml`：`actions/checkout@v4` / `actions/setup-node@v4` → `@v7`，`node-version` 20 → 24，消除 Node 20 弃用告警。

## [0.8.4] - 2026-08-19

> 文档版本，无功能变更。

### 文档
- 新增根目录 `CHANGELOG.md`。

## [0.8.3] - 2026-08-19

> 文档与注释清理版本，**无功能变更、无 API / 配置项变化**。

### 文档
- `README.md`：功能说明「渠道族优先」更正为「严格链序回退」——chain 顺序即完整回退优先级，每次失败后从链首扫描第一个「可用且非刚失败路由」，拖拽排序即全局重排；链末位（DeepSeek 官方）永远兜底。
- `README.md`：配置表 `codes` 默认值补齐 `TIMEOUT` / `TRANSPORT`，与 `Config` 源码默认值（`[QUOTA, RATE_LIMIT, SERVER, TIMEOUT, TRANSPORT]`）一致。

### 清理
- `src/core.js`：删除错位贴在 `validateChain` 前的旧 `pickFallbackTarget` JSDoc（「优先级 1 同 provider 其它 model → 2 同渠道族其它 provider → 3 跨族按链序」，含空 `@returns`），该描述与当前「严格沿 chain 从头扫描」实现矛盾；`validateChain` 自身注释保持原样。
- 移除 `lib/` 下遗留的开发备份 `index.js.bak-20260819-130328`（已被 `.gitignore` 的 `*.bak*` 忽略，不进版本库）。

### 校验
- `node test/core.test.mjs` 全过（8 组纯函数断言：providerFamily / displayNameOf / cooldownFor / routeUnavailable / pickFallbackTarget / validateChain / avoidTruncated / pushWindowMetric + windowSummary）。
