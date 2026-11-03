$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$prompt = Join-Path $PSScriptRoot 'setup-api-prompt.ps1'
$shell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path $shell)) { $shell = 'powershell.exe' }

try {
  $process = Start-Process -FilePath $shell `
    -ArgumentList @(
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', "`"$prompt`""
    ) `
    -WorkingDirectory $root `
    -WindowStyle Normal `
    -Wait `
    -PassThru
  exit $process.ExitCode
} catch {
  Write-Error "无法打开 API 配置窗口：$($_.Exception.Message)"
  exit 2
}
