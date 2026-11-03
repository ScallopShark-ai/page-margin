param(
  [switch]$NoMessageBox
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $root '.env'

function Read-EnvFile {
  $values = @{}
  if (-not (Test-Path $envPath)) { return $values }
  foreach ($line in Get-Content $envPath -ErrorAction SilentlyContinue) {
    if ($line -match '^\s*([^#=\s]+)\s*=\s*(.*)$') {
      $values[$matches[1].Trim()] = $matches[2].Trim().Trim('"').Trim("'")
    }
  }
  return $values
}

function Write-EnvFile([hashtable]$values) {
  $lines = if (Test-Path $envPath) { @(Get-Content $envPath) } else { @() }
  $seen = @{}
  $updated = @(foreach ($line in $lines) {
    if ($line -match '^\s*([^#=\s]+)\s*=' -and $values.ContainsKey($matches[1])) {
      $name = $matches[1]
      $seen[$name] = $true
      "$name=$($values[$name])"
    } else {
      $line
    }
  })
  foreach ($name in $values.Keys) {
    if (-not $seen.ContainsKey($name)) {
      $updated += "$name=$($values[$name])"
    }
  }
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText(
    $envPath,
    (($updated -join "`r`n") + "`r`n"),
    $utf8NoBom
  )
}

try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
} catch {
  Write-Error "无法加载 Windows 图形界面：$($_.Exception.Message)"
  exit 2
}

$existing = Read-EnvFile
$existingProvider = if ($existing.ContainsKey('AI_PROVIDER')) { [string]$existing['AI_PROVIDER'] } else { 'deepseek' }
$existingBase = if ($existing.ContainsKey('AI_BASE_URL')) { [string]$existing['AI_BASE_URL'] } else { '' }
$existingModel = if ($existing.ContainsKey('AI_MODEL')) { [string]$existing['AI_MODEL'] } else { '' }
$existingKey = if ($existing.ContainsKey('AI_API_KEY')) { [string]$existing['AI_API_KEY'] } else { '' }

$presets = @(
  [pscustomobject]@{
    Label = 'DeepSeek'
    Provider = 'deepseek'
    BaseUrl = 'https://api.deepseek.com'
    Model = 'deepseek-flash'
  },
  [pscustomobject]@{
    Label = 'OpenAI'
    Provider = 'openai'
    BaseUrl = 'https://api.openai.com/v1'
    Model = 'gpt-4o-mini'
  },
  [pscustomobject]@{
    Label = '自定义 OpenAI 兼容'
    Provider = 'custom'
    BaseUrl = ''
    Model = ''
  }
)

[System.Windows.Forms.Application]::EnableVisualStyles()
$form = New-Object System.Windows.Forms.Form
$form.Text = '海拉 API 配置'
$form.StartPosition = 'CenterScreen'
$form.TopMost = $true
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.ClientSize = New-Object System.Drawing.Size(500, 360)
$form.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9)
$form.BackColor = [System.Drawing.Color]::FromArgb(248, 244, 236)

$title = New-Object System.Windows.Forms.Label
$title.Text = '配置海拉使用的模型 API'
$title.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 14, [System.Drawing.FontStyle]::Bold)
$title.ForeColor = [System.Drawing.Color]::FromArgb(54, 43, 28)
$title.Location = New-Object System.Drawing.Point(24, 18)
$title.AutoSize = $true
$form.Controls.Add($title)

$hint = New-Object System.Windows.Forms.Label
$hint.Text = 'Key 只写入本机 .env，不会上传。此窗口可直接由部署 Agent 弹出。'
$hint.ForeColor = [System.Drawing.Color]::FromArgb(120, 105, 82)
$hint.Location = New-Object System.Drawing.Point(26, 50)
$hint.AutoSize = $true
$form.Controls.Add($hint)

function Add-Field([string]$label, [int]$top, [System.Windows.Forms.Control]$control) {
  $caption = New-Object System.Windows.Forms.Label
  $caption.Text = $label
  $caption.ForeColor = [System.Drawing.Color]::FromArgb(70, 60, 44)
  $caption.Location = New-Object System.Drawing.Point(26, $top)
  $caption.AutoSize = $true
  $form.Controls.Add($caption)
  $control.Location = New-Object System.Drawing.Point(26, ($top + 20))
  $control.Width = 448
  $form.Controls.Add($control)
}

$provider = New-Object System.Windows.Forms.ComboBox
$provider.DropDownStyle = 'DropDownList'
foreach ($preset in $presets) { [void]$provider.Items.Add($preset.Label) }
$provider.SelectedIndex = 0
if ($existingProvider -eq 'openai') { $provider.SelectedIndex = 1 }
if ($existingProvider -eq 'custom') { $provider.SelectedIndex = 2 }
Add-Field '服务商' 78 $provider

$keyBox = New-Object System.Windows.Forms.TextBox
$keyBox.UseSystemPasswordChar = $true
$keyBox.Text = ''
$keyPlaceholder = if ($existingKey) { '已有 Key；留空则保留原值' } else { 'sk-...' }
Add-Field 'API Key' 128 $keyBox
$keyHint = New-Object System.Windows.Forms.Label
$keyHint.Text = $keyPlaceholder
$keyHint.ForeColor = [System.Drawing.Color]::FromArgb(130, 112, 86)
$keyHint.Location = New-Object System.Drawing.Point(26, 178)
$keyHint.AutoSize = $true
$form.Controls.Add($keyHint)

$baseBox = New-Object System.Windows.Forms.TextBox
$baseBox.Text = if ($existingBase) { $existingBase } else { $presets[0].BaseUrl }
Add-Field 'API Base URL' 200 $baseBox

$modelBox = New-Object System.Windows.Forms.TextBox
$modelBox.Text = if ($existingModel) { $existingModel } else { $presets[0].Model }
Add-Field '模型名称' 250 $modelBox

$provider.add_SelectedIndexChanged({
  $preset = $presets[$provider.SelectedIndex]
  if ($preset.Provider -ne 'custom') {
    $baseBox.Text = $preset.BaseUrl
    $modelBox.Text = $preset.Model
  }
})

$save = New-Object System.Windows.Forms.Button
$save.Text = '保存并继续'
$save.DialogResult = [System.Windows.Forms.DialogResult]::OK
$save.Location = New-Object System.Drawing.Point(286, 310)
$save.Width = 100
$save.Height = 32
$save.BackColor = [System.Drawing.Color]::FromArgb(220, 89, 55)
$save.ForeColor = [System.Drawing.Color]::White
$save.FlatStyle = 'Flat'
$save.FlatAppearance.BorderSize = 0
$form.Controls.Add($save)

$cancel = New-Object System.Windows.Forms.Button
$cancel.Text = '取消'
$cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$cancel.Location = New-Object System.Drawing.Point(392, 310)
$cancel.Width = 82
$cancel.Height = 32
$cancel.FlatStyle = 'Flat'
$form.Controls.Add($cancel)
$form.AcceptButton = $save
$form.CancelButton = $cancel
$form.Tag = 'cancelled'

$save.add_Click({
  $providerValue = $presets[$provider.SelectedIndex].Provider
  $baseUrl = $baseBox.Text.Trim().TrimEnd('/')
  $model = $modelBox.Text.Trim()
  $key = $keyBox.Text.Trim()
  if (-not $key -and $existingKey) { $key = $existingKey }
  if (-not $key) {
    [void][System.Windows.Forms.MessageBox]::Show('请填写 API Key。', '海拉配置', 'OK', 'Warning')
    return
  }
  if (-not $baseUrl -or -not [Uri]::IsWellFormedUriString($baseUrl, [UriKind]::Absolute)) {
    [void][System.Windows.Forms.MessageBox]::Show('请填写完整的 http(s) Base URL。', '海拉配置', 'OK', 'Warning')
    return
  }
  if (-not $model) {
    [void][System.Windows.Forms.MessageBox]::Show('请填写模型名称。', '海拉配置', 'OK', 'Warning')
    return
  }
  try {
    $values = @{
      AI_PROVIDER = $providerValue
      AI_API_KEY = $key
      AI_BASE_URL = $baseUrl
      AI_MODEL = $model
    }
    Write-EnvFile $values
    $form.Tag = 'saved'
    if (-not $NoMessageBox) {
      [void][System.Windows.Forms.MessageBox]::Show(
        'API 已保存到 .env。可以继续部署。',
        '海拉配置',
        'OK',
        'Information'
      )
    }
    $form.Close()
  } catch {
    [void][System.Windows.Forms.MessageBox]::Show(
      "保存失败：$($_.Exception.Message)",
      '海拉配置',
      'OK',
      'Error'
    )
  }
})

[void]$form.ShowDialog()
if ($form.Tag -eq 'saved') { exit 0 }
exit 1
