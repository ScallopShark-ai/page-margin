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
$startupLog = Join-Path $runtimeDir 'startup.log'

function Read-DotEnv {
  $values = @{}
  $envPath = Join-Path $root '.env'
  if (-not (Test-Path $envPath)) { return $values }
  foreach ($line in Get-Content $envPath -ErrorAction SilentlyContinue) {
    if ($line -match '^\s*([^#=\s]+)\s*=\s*(.*)$') {
      $key = $matches[1].Trim()
      $value = $matches[2].Trim().Trim('"').Trim("'")
      $values[$key] = $value
    }
  }
  return $values
}

function Write-StartupLog([string]$message) {
  try {
    Add-Content -Path $startupLog -Encoding UTF8 -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message)
  } catch {
    # Startup logging must never block the app.
  }
}

function Test-TcpPort([string]$hostName, [int]$port, [int]$timeoutMs = 700) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $task = $client.ConnectAsync($hostName, $port)
    if (-not $task.Wait($timeoutMs)) { return $false }
    return $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Get-ProxyEndpoint([hashtable]$values) {
  $raw = $values['HTTPS_PROXY']
  if (-not $raw) { $raw = $values['HTTP_PROXY'] }
  if (-not $raw) { return $null }
  try {
    $uri = [Uri]$raw
    $port = if ($uri.Port -gt 0) { $uri.Port } elseif ($uri.Scheme -eq 'https') { 443 } else { 80 }
    return @{ Host = $uri.Host; Port = $port }
  } catch {
    return $null
  }
}

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

$dotenv = Read-DotEnv
$proxy = Get-ProxyEndpoint $dotenv
if ($proxy) {
  $proxyReady = Test-TcpPort $proxy.Host $proxy.Port
  if (-not $proxyReady -and $dotenv['PROXY_START_CMD']) {
    Write-StartupLog ("代理未启动，执行 PROXY_START_CMD：{0}" -f $dotenv['PROXY_START_CMD'])
    try {
      Start-Process -FilePath 'cmd.exe' `
        -ArgumentList '/d', '/c', $dotenv['PROXY_START_CMD'] `
        -WorkingDirectory $root `
        -WindowStyle Hidden | Out-Null
    } catch {
      Write-StartupLog ("PROXY_START_CMD 启动失败：{0}" -f $_.Exception.Message)
    }
    $waitSeconds = 45
    if ($dotenv['PROXY_WAIT_SECONDS'] -match '^\d+$') {
      $waitSeconds = [Math]::Max(0, [Math]::Min(120, [int]$dotenv['PROXY_WAIT_SECONDS']))
    }
    $proxyDeadline = (Get-Date).AddSeconds($waitSeconds)
    while ((Get-Date) -lt $proxyDeadline) {
      if (Test-TcpPort $proxy.Host $proxy.Port) { $proxyReady = $true; break }
      Start-Sleep -Milliseconds 800
    }
  }
  if ($proxyReady) {
    Write-StartupLog ("代理已就绪：{0}:{1}" -f $proxy.Host, $proxy.Port)
  } else {
    Write-StartupLog ("代理仍不可用：{0}:{1}；先启动海拉，稍后由 watchdog 自动恢复模型连接" -f $proxy.Host, $proxy.Port)
  }
}


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
