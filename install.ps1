# dsh-plugin-token-audit — 一键安装（Windows）
#
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall
#
# 可选参数：
#   -Port 48921              本地只读 HTTP 端口
#   -Budget 20000000         默认日预算（token）
#   -Pnpm <path>             手动指定 pnpm.cjs
#   -Node <path>             手动指定 node.exe

param(
  [switch]$Uninstall,
  [int]$Port = 48921,
  [int]$Budget = 20000000,
  [string]$Pnpm = '',
  [string]$Node = ''
)

$ErrorActionPreference = 'Stop'

$pkgName    = 'dsh-plugin-token-audit'
$profileDir = Join-Path $env:USERPROFILE '.dsh\profiles\desktop'
$pkgFile    = Join-Path $profileDir 'package.json'
$patchFile  = Join-Path $profileDir 'cordis.patch.yml'
$srcDir     = $PSScriptRoot

$MARK_BEGIN = '# >>> token-audit'
$MARK_END   = '# <<< token-audit'

if (-not (Test-Path $pkgFile)) {
  throw "找不到 $pkgFile —— 请先启动一次 DeepSeek Harness 桌面端。"
}
if (-not (Test-Path $patchFile)) {
  throw "找不到 $patchFile"
}

# ---------- 定位 DSH 安装目录 ----------
function Get-DshRoot {
  try {
    $proc = Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($proc -and $proc.Path) { return Split-Path $proc.Path -Parent }
  } catch { }
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness'),
    (Join-Path $env:ProgramFiles 'DeepSeek Harness')
  )
  if (${env:ProgramFiles(x86)}) { $candidates += (Join-Path ${env:ProgramFiles(x86)} 'DeepSeek Harness') }
  foreach ($c in $candidates) {
    if ($c -and (Test-Path (Join-Path $c 'DeepSeek Harness.exe'))) { return $c }
  }
  return $null
}

$dshRoot = Get-DshRoot

function Resolve-Node {
  if ($Node) { return $Node }
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  if ($dshRoot) {
    $p = Join-Path $dshRoot 'resources\runtime\bin\node.exe'
    if (Test-Path $p) { return $p }
  }
  return $null
}

function Resolve-Pnpm {
  if ($Pnpm) { return $Pnpm }
  if ($dshRoot) {
    $p = Join-Path $dshRoot 'resources\runtime\primary-runtime\dependencies\pnpm\bin\pnpm.cjs'
    if (Test-Path $p) { return $p }
  }
  $cmd = Get-Command pnpm -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}

$nodeExe = Resolve-Node
$pnpmJs  = Resolve-Pnpm

function Write-Utf8([string]$path, [string]$content) {
  [System.IO.File]::WriteAllText($path, $content, (New-Object System.Text.UTF8Encoding($false)))
}

function Remove-Block([string]$text) {
  $pattern = "(?ms)^" + [regex]::Escape($MARK_BEGIN) + ".*?^" + [regex]::Escape($MARK_END) + "\r?\n?"
  return [regex]::Replace($text, $pattern, '')
}

function Update-Dependency([string]$spec) {
  $json = Get-Content $pkgFile -Raw -Encoding UTF8 | ConvertFrom-Json
  if (-not $json.dependencies) {
    $json | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{}) -Force
  }
  if ($spec) {
    $json.dependencies | Add-Member -NotePropertyName $pkgName -NotePropertyValue $spec -Force
  } else {
    $json.dependencies.PSObject.Properties.Remove($pkgName)
  }
  Write-Utf8 $pkgFile ($json | ConvertTo-Json -Depth 10)
}

# bundle 由 profile 的 package.json 声明，不会被 DSH 改设置时重写掉
function Update-Bundle([switch]$Remove) {
  $json = Get-Content $pkgFile -Raw -Encoding UTF8 | ConvertFrom-Json
  if (-not $json.dsh) { $json | Add-Member -NotePropertyName dsh -NotePropertyValue ([pscustomobject]@{}) -Force }
  if (-not $json.dsh.profile) { $json.dsh | Add-Member -NotePropertyName profile -NotePropertyValue ([pscustomobject]@{}) -Force }
  if (-not $json.dsh.profile.bundles) {
    $json.dsh.profile | Add-Member -NotePropertyName bundles -NotePropertyValue @() -Force
  }
  $list = @($json.dsh.profile.bundles) | Where-Object { $_ -ne $pkgName }
  if (-not $Remove) { $list = @($list) + $pkgName }
  $json.dsh.profile.bundles = @($list)
  Write-Utf8 $pkgFile ($json | ConvertTo-Json -Depth 10)
}

function Invoke-PnpmInstall {
  if (-not $pnpmJs -or -not $nodeExe) {
    Write-Host "跳过 pnpm install（找不到 node 或 pnpm）" -ForegroundColor Yellow
    Write-Host "请手动执行：cd `"$profileDir`" ; pnpm install" -ForegroundColor Yellow
    return
  }
  Push-Location $profileDir
  try {
    & $nodeExe $pnpmJs install --reporter=append-only 2>&1 | ForEach-Object { "  " + $_ }
  } finally {
    Pop-Location
  }
}

# ---------------- 卸载 ----------------
if ($Uninstall) {
  Update-Dependency $null
  Update-Bundle -Remove
  $text = Get-Content $patchFile -Raw -Encoding UTF8
  Write-Utf8 $patchFile (Remove-Block $text)
  Invoke-PnpmInstall
  Write-Host "`n已卸载。重启 DeepSeek Harness 生效。" -ForegroundColor Yellow
  exit 0
}

# ---------------- 安装 ----------------
$spec = 'file:' + ($srcDir -replace '\\', '/')
Write-Host "插件路径 : $srcDir"
Write-Host "DSH 目录 : $(if ($dshRoot) { $dshRoot } else { '未检测到（将依赖 PATH 里的 pnpm）' })"
Write-Host "依赖声明 : $pkgName -> $spec"

Copy-Item $pkgFile  "$pkgFile.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')" -Force
Copy-Item $patchFile "$patchFile.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')" -Force

Update-Dependency $spec
Update-Bundle
Write-Host "已写入 profile/package.json（dependencies + bundles）"

Invoke-PnpmInstall

$installed = Join-Path $profileDir "node_modules\$pkgName"
if (Test-Path $installed) {
  Write-Host "依赖安装成功：$installed" -ForegroundColor Green
} else {
  Write-Host "依赖未出现在 node_modules —— 下次启动 DSH 时会补装。" -ForegroundColor Yellow
}

# 清理旧版本写进 profile patch 的残留块
$text = Get-Content $patchFile -Raw -Encoding UTF8
$cleaned = Remove-Block $text
if ($cleaned -ne $text) {
  Write-Utf8 $patchFile $cleaned
  Write-Host "已清理 cordis.patch.yml 中的旧残留块"
}

Write-Host ""
Write-Host "安装完成。请完全退出 DeepSeek Harness（含托盘图标）再重新打开。" -ForegroundColor Cyan
Write-Host "回滚：powershell -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall" -ForegroundColor Yellow
