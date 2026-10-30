$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$startScript = Join-Path $root 'scripts\start-haila.cmd'
if (-not (Test-Path $startScript)) {
  throw "找不到启动脚本：$startScript"
}

$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop '海拉 Haila.lnk'

$hailaIcon = Join-Path $root 'public\haila.ico'
if (Test-Path $hailaIcon) {
  $icon = $hailaIcon + ',0'
} else {
  $edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
  if (Test-Path $edge) {
    $icon = $edge + ',0'
  } else {
    $icon = (Join-Path $env:SystemRoot 'System32\SHELL32.dll') + ',13'
  }
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $startScript
$shortcut.Arguments = ''
$shortcut.WorkingDirectory = $root
$shortcut.WindowStyle = 7
$shortcut.IconLocation = $icon
$shortcut.Description = '启动海拉 AI 论文精读'
$shortcut.Save()

Write-Host "已创建桌面快捷方式：$shortcutPath"
Write-Host "双击后会启动本地服务并打开 http://127.0.0.1:8787"
