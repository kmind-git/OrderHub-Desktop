# Launch the Tauri desktop client with the local MSVC environment and the
# workspace config/data directories.
#
# Usage (from the repository root):
#   scripts/dev.ps1
#
# The script does not print or copy the Bearer Token.

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$vcvars = $null
$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path -LiteralPath $vswhere) {
    $installPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if ($installPath) {
        $candidate = Join-Path $installPath "VC\Auxiliary\Build\vcvars64.bat"
        if (Test-Path -LiteralPath $candidate) { $vcvars = $candidate }
    }
}
if (-not $vcvars) {
    Write-Error "未找到 MSVC vcvars64.bat。请安装 Visual Studio Build Tools 的 C++ 工具链，或在 x64 Native Tools Command Prompt 中运行 pnpm dev:tauri。"
}

$env:ORDERHUB_CONFIG_DIR = Join-Path $root "config"
if (-not $env:ORDERHUB_DATA_DIR) {
    $env:ORDERHUB_DATA_DIR = Join-Path $root "test-artifacts\runtime\desktop-data"
}
if (-not $env:CARGO_PROFILE_DEV_DEBUG) {
    # Reduces compiler memory pressure in constrained Windows build agents;
    # the MVP does not need Rust debug info for runtime verification.
    $env:CARGO_PROFILE_DEV_DEBUG = "0"
}
$tmp = Join-Path $root "test-artifacts\tmp"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$env:TMP = $tmp
$env:TEMP = $tmp

$command = 'call "' + $vcvars + '" >nul && pnpm --filter @orderhub/desktop dev:tauri'
Push-Location $root
try {
    cmd.exe /d /c $command
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
