$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host ''
Write-Host '海拉 API 配置' -ForegroundColor Cyan
Write-Host 'Key 只写入本机 .env，不会上传。' -ForegroundColor DarkGray
Write-Host ''

node scripts/configure-api.mjs --force
$code = $LASTEXITCODE

if ($code -eq 0) {
  $hasKey = Select-String -Path .env -Pattern '^\s*AI_API_KEY\s*=\s*\S+' -Quiet -ErrorAction SilentlyContinue
  if ($hasKey) {
    Write-Host ''
    Write-Host '配置已保存。可以关闭此窗口，回到 Agent 继续部署。' -ForegroundColor Green
  } else {
    Write-Host ''
    Write-Host '未检测到有效 AI_API_KEY。' -ForegroundColor Yellow
  }
} else {
  Write-Host ''
  Write-Host "配置未完成（退出码 $code）。" -ForegroundColor Yellow
}

Write-Host ''
[void](Read-Host '按 Enter 关闭窗口')
exit $code
