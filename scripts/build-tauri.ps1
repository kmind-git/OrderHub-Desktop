# Build the signed updater artifacts with the local test signing key.
#
# The test key lives under test-artifacts/keys (git-ignored). Replace it and
# the public key in src-tauri/tauri.conf.json before producing a real release.
# Usage:
#   scripts/build-tauri.ps1
#   scripts/build-tauri.ps1 -NoUpdaterArtifacts

param(
    [switch]$NoUpdaterArtifacts
)

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
if (-not $vcvars) { Write-Error "未找到 MSVC vcvars64.bat。" }

$key = Join-Path $root "test-artifacts\keys\orderhub-test.key"
$configArgs = ""
if (-not $NoUpdaterArtifacts) {
    if (-not (Test-Path -LiteralPath $key)) {
        Write-Error "缺少测试签名私钥：$key。先运行 pnpm --filter @orderhub/desktop tauri signer generate --ci -w `"$key`"。"
    }
    $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -LiteralPath $key -Raw
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
    $configArgs = " --config src-tauri/tauri.update.conf.json"
}

if (-not $env:CARGO_PROFILE_DEV_DEBUG) { $env:CARGO_PROFILE_DEV_DEBUG = "0" }
$env:ORDERHUB_CONFIG_DIR = Join-Path $root "config"
$tmp = Join-Path $root "test-artifacts\tmp"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$env:TMP = $tmp
$env:TEMP = $tmp

$command = 'call "' + $vcvars + '" >nul && pnpm --filter @orderhub/desktop tauri build' + $configArgs
Push-Location $root
try {
    cmd.exe /d /c $command
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
