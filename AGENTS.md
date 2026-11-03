# 海拉 · Agent 部署操作手册

本文件是给自动化 Agent 的执行说明。目标不是“给出建议”，而是把海拉完整部署到当前机器并通过验证。

执行前请通读全文。所有命令默认在项目根目录执行。Windows 优先使用 PowerShell。

---

## 0. 硬性规则

1. **不要伪造 API Key**。没有 Key 时先通过 `scripts/setup-api-ui.ps1` 或 `scripts/setup-api-console.ps1` 让用户填写；用户取消或窗口不可用时，完成不需要 Key 的步骤后停止，并明确报告“缺少 API Key”。
2. **不要把 API Key 写入聊天输出、提交到 Git、写进日志或截图中**。只写入项目根目录 `.env`。
3. **不要在 Agent 自己的 TTY 里直接运行交互式提示**。Agent 通常没有 TTY；需要用户输入时，用 `setup-api-ui.ps1` / `setup-api-console.ps1` 弹出独立窗口，或预先写 `.env`，然后使用 `--skip-api`。
4. **不要声称“全部部署成功”**，除非：
   - `npm run deploy` 退出码为 0
   - `npm run verify` 通过
   - `npm run test:gateway` 通过（或有明确且用户接受的 `/models` 不支持例外）
   - `/api/health` 返回 200
   - pdf2zh `/health` 返回 200（完整部署要求）
5. **不要为了让检查通过而删除测试、跳过错误或把失败改成警告**。
6. 发现已有海拉实例正在运行时，先检查健康状态，不要重复启动端口。
7. **不要将 8787 暴露到公网**。当前服务只监听 `127.0.0.1`。

---

## 1. 判断当前状态

```powershell
$root = (Get-Location).Path
node --version
npm --version
git --version
Test-Path .\package.json
Test-Path .\.env
```

如果项目根目录没有 `package.json`，先获取项目：

```powershell
git clone https://github.com/ScallopShark-ai/page-margin.git haila
Set-Location .\haila
```

如果已经在项目中：

```powershell
git status --short
```

- 工作区干净：可以 `git pull --ff-only` 获取最新版本。
- 工作区有未提交修改：**不要覆盖**。记录状态，向用户报告后再决定。
- 已有 `node_modules` 不影响部署；`npm run deploy` 会使用 `npm ci` 重新安装。

检查是否已有服务：

```powershell
try {
  (Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8787/api/health -TimeoutSec 3).StatusCode
} catch { "not running" }
```

---

## 2. 环境要求

| 项目 | 要求 |
|---|---|
| Node.js | 22+；使用本地代理时必须 24+ |
| npm | 随 Node 安装 |
| Git | 部署不强制；升级需要 |
| 磁盘 | 至少 900 MB 空闲（pdf2zh 模型缓存另计） |
| 网络 | 首次部署需要访问 GitHub、npm、Python 包源和模型网关 |
| Python | 可选；pdf2zh 需要 `uv` 或 Python 3.12 |
| 端口 | 8787 和 8891，均只监听本机 |

先运行：

```powershell
npm run doctor
```

- 退出码非 0：不要继续，修复 Node/npm/磁盘等硬性项。
- 退出码 0 但有警告：记录警告。缺少 uv/Python 时 pdf2zh 可能无法安装。

Node 22 只能直连模型网关；如果 `.env` 配置了本地 HTTP/HTTPS 代理，必须使用 Node 24+。

---

## 3. 配置 `.env`

### 3.1 用户提供了 Key

当前 DeepSeek 官方默认使用 `deepseek-flash`（DeepSeek-V4.1-Flash-1017）。`deepseek-chat` 是旧别名，不要用于新部署。

将以下内容写入项目根目录 `.env`。保留已有代理配置，不要覆盖其他键。

```dotenv
AI_PROVIDER=deepseek
AI_API_KEY=<用户提供的 Key>
AI_BASE_URL=https://api.deepseek.com
AI_MODEL=deepseek-flash
```

如果用户使用 OpenAI 或兼容网关：

```dotenv
AI_PROVIDER=openai
AI_API_KEY=<用户提供的 Key>
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=<支持聊天的模型名>
```

需要代理时追加：

```dotenv
HTTPS_PROXY=http://127.0.0.1:6518
HTTP_PROXY=http://127.0.0.1:6518
NO_PROXY=localhost,127.0.0.1,::1
```

端口替换成用户实际的代理端口。

已有 `.env` 时只追加或替换 `AI_*` 行，不要清空代理配置。**不要把 `.env` 打印出来。**

如果 `$apiKey` 已经由操作者安全地放在 Agent 的变量/秘密存储中，用下面的更新函数保留现有代理配置：

```powershell
$apiKey = '<用户提供的 Key>'
$envPath = Join-Path (Get-Location) '.env'
$values = [ordered]@{
  AI_PROVIDER = 'deepseek'
  AI_API_KEY = $apiKey
  AI_BASE_URL = 'https://api.deepseek.com'
  AI_MODEL = 'deepseek-flash'
}
$lines = if (Test-Path $envPath) { Get-Content $envPath } else { @() }
$seen = @{}
$updated = @(foreach ($line in $lines) {
  if ($line -match '^\s*([^#=\s]+)\s*=' -and $values.Contains($matches[1])) {
    $name = $matches[1]
    $seen[$name] = $true
    "$name=$($values[$name])"
  } else { $line }
})
foreach ($name in $values.Keys) {
  if (-not $seen.ContainsKey($name)) { $updated += "$name=$($values[$name])" }
}
# 写 UTF-8 无 BOM，避免 Node 把 BOM 当成第一个 key 的一部分
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText(
  $envPath,
  (($updated -join "`r`n") + "`r`n"),
  $utf8NoBom
)
Remove-Variable apiKey
```

如果操作者已经预置 `.env`，**不要再次写入或打印**，直接跳到部署。

Agent 没有交互式终端时，不要使用 `Read-Host` 或 `npm run configure:api` 的交互模式；改用从秘密存储取得的变量写 `.env`，或让操作者预先配置 `.env`。

### 3.2 用户没有提供 Key：弹出配置界面

不要编造 Key，也不要直接放弃。先尝试让用户在本机弹窗中填写：

**Windows 图形界面（推荐）**

```powershell
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File .\scripts\setup-api-ui.ps1
```

该命令会打开一个独立的小窗口，用户填写服务商、API Key、Base URL 和模型。
保存后窗口自动关闭，Key 写入 `.env`。也可以直接运行：

```powershell
npm run setup:api:ui
```

如果海拉已经在运行，配置完成后必须重启服务，因为 `.env` 只在启动时读取。

等待命令退出后，检查（不要把 Key 打印出来）：

```powershell
$hasKey = Select-String -Path .env -Pattern '^\s*AI_API_KEY\s*=\s*\S+' -Quiet
if (-not $hasKey) { throw '用户尚未完成 API Key 配置' }
```

**没有图形桌面时，打开新的命令行窗口**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-api-console.ps1
```

该命令会打开一个独立 PowerShell 窗口，运行遮罩输入的 API 配置提示，并在用户按 Enter 后返回。

如果用户取消、窗口无法显示，或退出后 `.env` 仍然没有 Key，则停止并报告：

```text
缺少 AI API Key，无法完成完整部署。
请提供 DeepSeek 或 OpenAI 兼容服务的 API Key、Base URL 和模型名。
```

不要使用 `--skip-api` 后声称完整部署；这只能算“核心功能已安装，模型未配置”。

### 3.3 非交互配置（可选）

`npm run deploy -- --skip-api` 只读取已经存在的 `.env`，不会从 `$env:AI_API_KEY` 自动创建 `.env`。

如果用户已经把 Key 放在 Agent 的秘密变量或临时环境变量中，可以只在当前执行进程中使用它来写 `.env`：

```powershell
# 不要把真实 Key 直接放进命令历史或日志
$apiKey = $env:HAILA_API_KEY
if (-not $apiKey) { throw '缺少 HAILA_API_KEY' }
```

然后使用 3.1 的更新函数写入 `.env`。服务重启后仍以 `.env` 为准，不要依赖临时 shell 环境变量。

如果操作者可以直接预置 `.env`，这是最安全的方式。

---

## 4. 执行部署

完整部署（包含 PDF 翻译，非交互）：

```powershell
npm run deploy -- --skip-api --require-pdf2zh
```

说明：

- `--skip-api`：跳过交互式 Key 输入；Key 已在上一步写入 `.env`。
- `--require-pdf2zh`：把 PDF 翻译作为硬性要求；pdf2zh 失败则部署失败。
- 不加 `--skip-api` 会启动交互式提示，Agent 无法可靠输入，不要使用。
- 部署会使用 `npm ci`、构建前端，并临时启动服务做验证。

如果用户明确不需要 PDF 翻译：

```powershell
npm run deploy -- --skip-api --skip-pdf2zh
```

但这不是“全部功能部署”。

### pdf2zh 失败时

先查看失败输出和：

```text
.runtime/pdf2zh-service.log
.runtime/startup.log
```

常见处理：

```powershell
npm run setup:pdf2zh
```

仍失败时检查：

- 是否安装了 `uv` 或 Python 3.12
- 是否能访问 GitHub / Python 包源
- 磁盘是否足够
- 是否有防火墙/代理问题
- `.runtime` 目录是否可写

修复后重新执行 `npm run deploy -- --skip-api --require-pdf2zh`。

**不要**用 `--skip-pdf2zh` 掩盖失败并声称完整部署。

### 网关严格模式

如果用户要求部署必须验证网关：

```powershell
npm run deploy -- --skip-api --require-pdf2zh --require-gateway
```

但部分兼容网关不实现 `/models`，这不代表聊天不可用。遇到这种情况，记录失败原因，向用户确认是否接受“网关测试失败但聊天接口可能可用”。

---

## 5. 启动海拉

部署完成后，先检查是否已经有服务在运行：

```powershell
try {
  $r = Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8787/api/health -TimeoutSec 3
  $r.StatusCode
} catch { "not running" }
```

### 已有实例

不要重复启动。直接使用现有实例，继续验证。

### Windows 后台启动

```powershell
$root = (Get-Location).Path
Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c", "scripts\start-haila.cmd -NoBrowser" `
  -WorkingDirectory $root `
  -WindowStyle Hidden
```

等待：

```powershell
$deadline = (Get-Date).AddSeconds(60)
do {
  Start-Sleep -Seconds 1
  try { $ok = (Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8787/api/health -TimeoutSec 2).StatusCode -eq 200 } catch { $ok = $false }
} until ($ok -or (Get-Date) -gt $deadline)
if (-not $ok) {
  Get-Content .runtime\haila-boot.err.log -Tail 80
  Get-Content .runtime\haila-boot.log -Tail 80
  throw "Haila failed to start"
}
```

### Linux/macOS 后台启动

```bash
nohup node server/start.mjs > .runtime/haila-boot.log 2>&1 &
```

等待 `/api/health` 返回 200。

### 重启已有实例

仅在必要时执行。会中断正在进行的对话、PDF 翻译和后台任务。

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'server/start.mjs' } |
  ForEach-Object { taskkill /PID $_.ProcessId /T /F }
```

然后重新按上面的后台启动步骤启动。

---

## 6. 完整验证清单

逐项执行并记录退出码。

```powershell
npm run doctor
npm run verify
npm run test:gateway
```

要求：

- `npm run doctor` 退出码 0；警告要记录。
- `npm run verify` 退出码 0。
- `npm run test:gateway` 退出码 0。
  - 退出码 2：缺少服务器 Key，不算完整部署。
  - 退出码 1：网关/Key/代理/`/models` 问题，记录响应内容。

HTTP 检查：

```powershell
(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8787/api/health).StatusCode
```

Haila 健康后 **不要立即**判定 pdf2zh 失败；它可能还在启动。最多等待 60 秒：

```powershell
$deadline = (Get-Date).AddSeconds(60)
do {
  Start-Sleep -Seconds 1
  try {
    $pdf2zhOk = (Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8891/health -TimeoutSec 2).StatusCode -eq 200
  } catch { $pdf2zhOk = $false }
} until ($pdf2zhOk -or (Get-Date) -gt $deadline)
if (-not $pdf2zhOk) {
  Get-Content .runtime\pdf2zh-service.log -Tail 100
  throw "pdf2zh 未在 60 秒内就绪"
}
"pdf2zh health: 200"
```

配置检查：

```powershell
$config = Invoke-RestMethod http://127.0.0.1:8787/api/config
$config.serverConfigured
$config.provider
$config.model
```

期望：

```text
8787 /api/health        200
8891 /health            200
serverConfigured        True
provider/model          与用户提供的一致
```

查看部署状态：

```powershell
Get-Content .runtime\deployment-status.json
```

检查 `verified`、`pdf2zh`、`gatewayTested` 是否为 true。不要把整个 `.env` 或 Key 打印到日志。

### `/models` 不支持的例外

如果 `test:gateway` 失败但错误明确是：

```text
404 / 405 / not found / unsupported
```

并且用户确认网关只支持聊天接口：

1. 记录这个限制。
2. 不要声称网关测试通过。
3. 请用户授权后再发一条真实聊天消息做最终验证。
4. 不要在未授权的情况下消耗模型费用。

---

## 7. 桌面快捷方式（Windows）

如果当前是交互式 Windows 桌面：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-haila-shortcut.ps1
```

如果是无桌面/远程无头环境，记录“未创建快捷方式”，不要假装创建成功。

---

## 8. 完成报告格式

向用户报告以下内容。**不要包含 API Key。**

```text
部署状态：PASS / PARTIAL / FAIL
项目目录：
访问地址：http://127.0.0.1:8787
Node 版本：
模型服务商：
模型名称：
Base URL：
pdf2zh：可用 / 不可用 / 跳过
doctor：通过 / 警告
verify：通过 / 失败
gateway：通过 / 失败 / 不支持 /models
后台服务：已启动 / 已在运行 / 未启动
桌面快捷方式：已创建 / 未创建
日志位置：
剩余风险：
```

只有所有硬性条件通过时才写 `PASS`。

---

## 9. 常见失败处理

### Node 版本过低

```text
需要 Node.js 22+，代理模式需要 Node.js 24+。
```

升级 Node 后重新执行 `npm run doctor`。

### 代理不可用

检查 `.env`：

```dotenv
HTTPS_PROXY=http://127.0.0.1:6518
HTTP_PROXY=http://127.0.0.1:6518
```

确认代理端口实际监听。代理不可用时 Haila 会尝试直连；如果网关必须走代理，网关测试会失败。

### 网关测试失败

依次检查：

1. `.env` 的 `AI_API_KEY` 是否存在。
2. Base URL 是否需要 `/v1`。
3. 模型是否支持 `/models`。
4. 代理是否可达。
5. 网关是否只支持 `/chat/completions`。

不要修改测试逻辑来“让它通过”。

### pdf2zh 安装失败

```powershell
npm run setup:pdf2zh
```

仍然失败就报告具体错误和日志，不要悄悄降级为“完整部署通过”。

### 端口已占用

确认占用者是否是海拉：

```powershell
netstat -ano | findstr :8787
netstat -ano | findstr :8891
```

不要随意杀掉不属于本项目的进程。

---

## 10. 最终判定

满足以下全部条件才算完成：

- [ ] `.env` 含有效 AI 配置，且未被提交到 Git
- [ ] `npm run deploy -- --skip-api --require-pdf2zh` 成功
- [ ] `npm run verify` 成功
- [ ] `npm run test:gateway` 成功，或有用户接受的明确例外
- [ ] `/api/health` 返回 200
- [ ] `pdf2zh /health` 返回 200
- [ ] 服务在后台运行
- [ ] 日志中未泄露 API Key
- [ ] 向用户报告了所有警告和剩余风险

如果任何一项不满足，状态写 `PARTIAL` 或 `FAIL`，并说明具体阻塞项。
