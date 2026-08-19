# monitor-usage.ps1 — 火山方舟用量监测脚本(零 Token)
# 只从控制面拉套餐额度(arkcli usage plan),不探测任何模型。
# 商汤用量由 dsh-llm-fallback 插件被动记录(请求成功/失败),本脚本不主动探测。
#
# 产出 usage.json:
#   {
#     "updated_at": <epoch-ms>,
#     "ark": { "5h": {used,total,percent,reset_at}, "weekly": {...}, "monthly": {...} }
#   }
#
# 用法:PowerShell 定时任务 / 手动执行:
#   powershell -File monitor-usage.ps1
#   powershell -File monitor-usage.ps1 -UsageFile "D:\dsh\usage.json"   # 自定义输出路径
# 默认与插件 usageFile 一致(~/.dsh/plugins/llm-fallback/usage.json)
param(
    [string]$UsageFile = (Join-Path $HOME '.dsh\plugins\llm-fallback\usage.json')
)

$ErrorActionPreference = "Continue"
$snapshotDir = Split-Path $UsageFile -Parent
if (-not (Test-Path $snapshotDir)) { New-Item -ItemType Directory -Force -Path $snapshotDir | Out-Null }

# ---- 火山方舟:套餐用量(arkcli usage plan,控制面,不耗推理 Token) ----
function Get-ArkUsage {
    try {
        $env:ARKCLI_CALLER_TYPE = "ai_agent"
        $env:ARKCLI_CALLER_NAME = "dsh-web-gui"
        $env:ARKCLI_SKILL_NAME = "arkcli-usage"
        $json = arkcli usage plan 2>$null | Out-String
        $obj = $json | ConvertFrom-Json
        $plan = $obj.items | Where-Object { $_.product -eq "agent-plan" } | Select-Object -First 1
        if (-not $plan) { return @{} }
        $out = @{}
        foreach ($p in $plan.periods) {
            $out[$p.label] = @{
                used = [double]$p.used
                total = [double]$p.total
                percent = [double]$p.percent
                reset_at = $p.reset_at
            }
        }
        return $out
    } catch {
        return @{}
    }
}

$snapshot = @{
    updated_at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    ark = Get-ArkUsage
}

# 合并历史 sensenova 状态(若有),避免首次覆盖丢失;不发起新探测。
if (Test-Path $UsageFile) {
    try {
        $old = Get-Content $UsageFile -Raw | ConvertFrom-Json
        if ($old.sensenova) {
            $snapshot.sensenova = $old.sensenova
        }
    } catch {}
}

$snapshotJson = $snapshot | ConvertTo-Json -Depth 6 -Compress
# UTF-8 无 BOM 写入(Windows PowerShell 5.1 的 Set-Content -Encoding UTF8 会写 BOM,导致 node JSON.parse 失败)
[System.IO.File]::WriteAllText($UsageFile, $snapshotJson, (New-Object System.Text.UTF8Encoding($false)))
Write-Output "usage.json written (zero-token): $(Get-Item $UsageFile | Select-Object -ExpandProperty Length) bytes"
