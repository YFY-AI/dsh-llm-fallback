# dsh-llm-fallback 发布全流程复盘

## 核心教训

### 1. DSH 沙箱终端无法 `git push`
- **现象**：`getaddrinfo() thread failed to start`
- **原因**：沙箱线程池/网络栈受限
- **解决**：必须在**本地真终端**（PowerShell/CMD/Git Bash）执行推送
- **原则**：DSH 写代码/跑测试/生成提交；本地终端/CI 做推送发布

### 2. npmjs.com 公开注册已关闭
- 2023 年起禁止新账号注册
- **替代方案**：GitHub Packages (`npm.pkg.github.com`)
- **优势**：复用 GitHub 身份，零额外注册，`GITHUB_TOKEN` 自动可用

### 3. GitHub Packages 强制 scoped 包名
- 包名必须为 `@owner/name` 格式
- `package.json` 中 `name` 必须带 scope
- 安装时需指定 registry：`--registry=https://npm.pkg.github.com/`

### 4. Workflow 关键配置
```yaml
permissions:
  contents: read
  id-token: write
  packages: write  # 必须

jobs.build:
  steps:
    - uses: actions/setup-node@v4
      with:
        registry-url: https://npm.pkg.github.com/
    - run: npm publish --provenance --access public
      env:
        NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}  # 自动可用
```

### 5. 常见坑及规避
| 坑 | 规避 |
|----|------|
| PowerShell 用 `&&` 报错 | 用 `;` 或分行 |
| tag 推送前未改 workflow | 先改文件、提交、再推 tag |
| 缺 `NPM_TOKEN` 导致 403 | 改用 GitHub Packages 彻底避免 |
| 包名无 scope 导致 404 | 强制 `@owner/name` 格式 |
| 远程分支冲突 | `git push --force-with-lease` |

---

## 标准发布 SOP（下次直接照抄）

```bash
# 1. 本地终端（非 DSH 沙箱）
cd F:\code\dsh-llm-fallback

# 2. 改代码、提交
git add . && git commit -m "feat: ..."

# 3. 推送主分支
git push origin main

# 4. 打 tag 触发自动发布
git tag v0.2.0
git push origin v0.2.0

# 5. 去 Actions 看绿灯 → 完成
```

---

## 项目关键信息

| 项目 | 值 |
|------|-----|
| 仓库 | https://github.com/YFY-AI/dsh-llm-fallback |
| 包名 | `@YFY-AI/dsh-llm-fallback` |
| Registry | `https://npm.pkg.github.com/` |
| 安装命令 | `npm i @YFY-AI/dsh-llm-fallback --registry=https://npm.pkg.github.com/` |
| 发布触发 | 推送 `v*` tag |
| 认证 | `GITHUB_TOKEN` (自动) |

---

## 避坑清单（新项目复用）

- [ ] `package.json` name 为 `@owner/name`
- [ ] `publishConfig.registry` = `https://npm.pkg.github.com/`
- [ ] workflow `permissions.packages: write`
- [ ] workflow `registry-url: https://npm.pkg.github.com/`
- [ ] workflow `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`
- [ ] **不需要**在 GitHub Secrets 配置任何 token
- [ ] **必须**在本地真终端 `git push origin main && git push origin vX.Y.Z`