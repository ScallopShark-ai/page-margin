param(
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$url = 'http://127.0.0.1:8787'
$healthUrl = "$url/api/health"
$runtimeDir = Join-Path $root '.runtime'
$logPath = Join-Path $runtimeDir 'haila-boot.log'
$errPath = Join-Path $runtimeDir 'haila-boot.err.log'

function Test-Haila {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 3
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

if (Test-Haila) {
  if (-not $NoBrowser) { Start-Process $url }
  exit 0
}

New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

$node = Get-Command 'node.exe' -ErrorAction SilentlyContinue
if (-not $node) {
  $node = Get-Command 'node' -ErrorAction SilentlyContinue
}
if (-not $node) {
  Write-Host '未找到 Node.js。请先安装 Node.js 22+。'
  exit 1
}

Start-Process -FilePath $node.Source `
  -ArgumentList 'server/start.mjs' `
  -WorkingDirectory $root `
  -WindowStyle Hidden `
  -RedirectStandardOutput $logPath `
  -RedirectStandardError $errPath | Out-Null

$deadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 1
  if (Test-Haila) { break }
}

if (-not (Test-Haila)) {
  Write-Host '海拉启动失败。日志：'
  Write-Host $logPath
  if (Test-Path $logPath) {
    Start-Process notepad.exe -ArgumentList ('"' + $logPath + '"')
  }
  exit 1
}

if (-not $NoBrowser) { Start-Process $url }
