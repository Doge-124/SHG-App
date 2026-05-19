# SHG Manager release script.
#
# Usage:
#   .\scripts\release.ps1 -Version 1.0.1
#   .\scripts\release.ps1 -Version 1.0.1 -SkipChecks
#   .\scripts\release.ps1 -Version 1.0.1 -DryRun
#   .\scripts\release.ps1 -Version 1.0.1 -Force      # ignore dirty working tree

param(
    [Parameter(Mandatory=$true)]
    [string]$Version,

    [switch]$SkipChecks,
    [switch]$DryRun,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

# ---- Validation ----------------------------------------------------------
if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    Write-Host "ERROR: Version must be semver (e.g. 1.0.1). Got: $Version" -ForegroundColor Red
    exit 1
}

$Tag = "v$Version"

# Move to repo root (script lives in repo/scripts/)
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $RepoRoot

Write-Host ""
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host "  SHG Manager Release: $Tag" -ForegroundColor Cyan
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host ""

# ---- Git status check ----------------------------------------------------
# Auto-revert no-op CRLF/LF-only changes to Cargo.lock (recurring PS5.1/cargo papercut).
$lockStat = git diff --numstat src-tauri/Cargo.lock 2>$null
if ($lockStat) {
    $parts = $lockStat -split "\s+"
    # If only 1 line added + 1 line removed, it's pure line-ending churn -- safe to revert.
    if ($parts[0] -eq '1' -and $parts[1] -eq '1') {
        Write-Host "Auto-reverting Cargo.lock (line-ending noise only, no real diff)" -ForegroundColor DarkGray
        git checkout -- src-tauri/Cargo.lock
    }
}

$status = git status --porcelain
if ($status -and -not $Force) {
    Write-Host "ERROR: Working tree has uncommitted changes:" -ForegroundColor Red
    git status --short
    Write-Host ""
    Write-Host "Commit/stash first, OR re-run with -Force to include them." -ForegroundColor Yellow
    exit 1
}

# ---- Check tag doesn't exist --------------------------------------------
$existingTag = git tag --list $Tag
if ($existingTag) {
    Write-Host "ERROR: Tag $Tag already exists." -ForegroundColor Red
    Write-Host "Delete with: git tag -d $Tag" -ForegroundColor Yellow
    exit 1
}

# ---- Read current version ------------------------------------------------
$cargoToml = Get-Content 'src-tauri\Cargo.toml' -Raw
$currentVersion = '?'
if ($cargoToml -match '(?m)^version\s*=\s*"([^"]+)"') {
    $currentVersion = $matches[1]
}
Write-Host "Current version: $currentVersion"
Write-Host "New version:     $Version" -ForegroundColor Green
Write-Host ""

if ($currentVersion -eq $Version) {
    Write-Host "ERROR: New version equals current version. Bump it." -ForegroundColor Red
    exit 1
}

# ---- Update version files ------------------------------------------------
# Using simple string concat for replacement to avoid PS quote-escape issues.
# IMPORTANT: write with [System.IO.File]::WriteAllText (UTF-8 NO BOM).
# Set-Content -Encoding UTF8 in PS 5.1 writes UTF-8 *with* BOM, which corrupts
# JSON files (parsers reject the leading 0xEF 0xBB 0xBF bytes).
Write-Host "Updating version files..." -ForegroundColor Cyan

function Write-FileUtf8NoBom([string]$Path, [string]$Content) {
    $absolutePath = [System.IO.Path]::GetFullPath($Path)
    [System.IO.File]::WriteAllText($absolutePath, $Content)
}

# src-tauri/Cargo.toml -- TOML format: version = "x.y.z"
$cargoPattern = '(?m)^version\s*=\s*"[^"]+"'
$cargoReplacement = 'version = "' + $Version + '"'
$cargoNew = $cargoToml -replace $cargoPattern, $cargoReplacement
Write-FileUtf8NoBom 'src-tauri\Cargo.toml' $cargoNew
Write-Host "  [OK] src-tauri/Cargo.toml" -ForegroundColor Green

# JSON files: "version": "x.y.z"
$jsonPattern = '"version"\s*:\s*"[^"]+"'
$jsonReplacement = '"version": "' + $Version + '"'

# src-tauri/tauri.conf.json
$tauriConf = Get-Content 'src-tauri\tauri.conf.json' -Raw
$tauriNew = $tauriConf -replace $jsonPattern, $jsonReplacement
Write-FileUtf8NoBom 'src-tauri\tauri.conf.json' $tauriNew
Write-Host "  [OK] src-tauri/tauri.conf.json" -ForegroundColor Green

# package.json (root, optional)
if (Test-Path 'package.json') {
    $pkgJson = Get-Content 'package.json' -Raw
    $pkgNew = $pkgJson -replace $jsonPattern, $jsonReplacement
    Write-FileUtf8NoBom 'package.json' $pkgNew
    Write-Host "  [OK] package.json" -ForegroundColor Green
}

# frontend/package.json (optional)
if (Test-Path 'frontend\package.json') {
    $feJson = Get-Content 'frontend\package.json' -Raw
    $feNew = $feJson -replace $jsonPattern, $jsonReplacement
    Write-FileUtf8NoBom 'frontend\package.json' $feNew
    Write-Host "  [OK] frontend/package.json" -ForegroundColor Green
}

Write-Host ""

# ---- Compile checks ------------------------------------------------------
# Note: do NOT use `2>&1` here. In Windows PowerShell 5.1, redirecting a native
# command's stderr wraps each line as a NativeCommandError, which combined with
# $ErrorActionPreference='Stop' aborts the script even on a successful exit.
# Cargo writes normal status messages (file locks, build progress) to stderr.
if (-not $SkipChecks) {
    Write-Host "Running cargo check..." -ForegroundColor Cyan
    Push-Location src-tauri
    try {
        # Temporarily relax ErrorActionPreference so native stderr doesn't abort.
        $oldEAP = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        & cargo check
        $cargoExit = $LASTEXITCODE
        $ErrorActionPreference = $oldEAP
        if ($cargoExit -ne 0) {
            Write-Host "ERROR: cargo check failed (exit $cargoExit)." -ForegroundColor Red
            Pop-Location
            exit 1
        }
        Write-Host "  [OK] Rust compiles" -ForegroundColor Green
    } finally {
        Pop-Location
    }

    Write-Host "Running tsc --noEmit..." -ForegroundColor Cyan
    Push-Location frontend
    try {
        $oldEAP = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        # Call tsc.cmd directly. npx can fail in PS 5.1 with "could not determine
        # executable to run" even when the local binary is present, so we bypass it.
        $tscBin = Join-Path (Get-Location) 'node_modules\.bin\tsc.cmd'
        if (Test-Path $tscBin) {
            & $tscBin --noEmit
        } else {
            Write-Host "WARNING: tsc.cmd not found at $tscBin -- run 'npm install' in frontend/ first" -ForegroundColor Yellow
            Write-Host "         Falling back to npx (may fail)..." -ForegroundColor Yellow
            & npx tsc --noEmit
        }
        $tscExit = $LASTEXITCODE
        $ErrorActionPreference = $oldEAP
        if ($tscExit -ne 0) {
            Write-Host "ERROR: TypeScript check failed (exit $tscExit)." -ForegroundColor Red
            Pop-Location
            exit 1
        }
        Write-Host "  [OK] TypeScript compiles" -ForegroundColor Green
    } finally {
        Pop-Location
    }
    Write-Host ""
}

# ---- Show diff -----------------------------------------------------------
Write-Host "Files to be committed:" -ForegroundColor Cyan
git diff --stat
Write-Host ""

# ---- Dry run stops here --------------------------------------------------
if ($DryRun) {
    Write-Host "DRY RUN -- stopping. No commit, no tag, no push." -ForegroundColor Yellow
    Write-Host "Version files have been edited. Run 'git checkout .' to revert." -ForegroundColor Yellow
    exit 0
}

# ---- Confirm -------------------------------------------------------------
Write-Host "Ready to commit, tag $Tag, and push (triggers release build)." -ForegroundColor Yellow
$confirm = Read-Host "Proceed? (y/N)"
if ($confirm -ne 'y' -and $confirm -ne 'Y') {
    Write-Host "Aborted. Run 'git checkout .' to revert version bumps." -ForegroundColor Red
    exit 1
}

# ---- Commit, tag, push ---------------------------------------------------
Write-Host ""
Write-Host "Committing..." -ForegroundColor Cyan
git add src-tauri\Cargo.toml src-tauri\tauri.conf.json
if (Test-Path 'package.json') { git add package.json }
if (Test-Path 'frontend\package.json') { git add frontend\package.json }
git add -u

git commit -m "chore: release $Tag"
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: commit failed" -ForegroundColor Red; exit 1 }

Write-Host "Tagging..." -ForegroundColor Cyan
git tag -a $Tag -m "Release $Tag"

Write-Host "Pushing commit..." -ForegroundColor Cyan
git push origin HEAD
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: push failed" -ForegroundColor Red; exit 1 }

Write-Host "Pushing tag (triggers release build)..." -ForegroundColor Cyan
git push origin $Tag
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: tag push failed" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "===========================================================" -ForegroundColor Green
Write-Host "  [OK] $Tag pushed" -ForegroundColor Green
Write-Host "===========================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Build status: https://github.com/Doge-124/SHG-App/actions"
Write-Host "When ready:   https://github.com/Doge-124/SHG-App/releases/tag/$Tag"
Write-Host ""
Write-Host "Customers will see the update prompt on next launch." -ForegroundColor Gray
