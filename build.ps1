# build.ps1 — Sentinel Production Build Script
# Usage: .\build.ps1 [-Clean] [-SkipUI] [-SkipPublish] [-SkipTests] [-Installer]

param(
    [switch]$Clean,
    [switch]$SkipUI,
    [switch]$SkipPublish,
    [switch]$SkipTests,
    [switch]$Installer
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$UIDir = Join-Path $Root "Sentinel.UI"
$EngineDir = Join-Path $Root "Sentinel.Engine"
$WwwrootDir = Join-Path $EngineDir "wwwroot"
$PublishDir = Join-Path $Root "publish"

$steps = if ($Installer) { 6 } else { 5 }
Write-Host "`n=== Sentinel Build ===" -ForegroundColor Cyan

# Clean
if ($Clean) {
    Write-Host "`n[1/$steps] Cleaning..." -ForegroundColor Yellow
    if (Test-Path $WwwrootDir) { Remove-Item $WwwrootDir -Recurse -Force }
    if (Test-Path $PublishDir) { Remove-Item $PublishDir -Recurse -Force }
    dotnet clean "$EngineDir" -c Release --nologo -q
    Write-Host "  Cleaned." -ForegroundColor Green
}

# Run tests
if (-not $SkipTests) {
    Write-Host "`n[1.5/$steps] Running tests..." -ForegroundColor Yellow
    & "$Root\test-all.ps1" -Configuration Release
    if ($LASTEXITCODE -ne 0) { throw "Tests failed — aborting build." }
    Write-Host "  All tests passed." -ForegroundColor Green
} else {
    Write-Host "`n[1.5/$steps] Skipping tests." -ForegroundColor DarkGray
}
# Restore dependencies
Write-Host \"`n[1.8/$steps] Restoring dependencies...\" -ForegroundColor Yellow
dotnet restore \"$EngineDir\" --nologo -q
Push-Location $UIDir
try {
    npm ci --silent
}
finally { Pop-Location }
Write-Host \"  Dependencies restored.\" -ForegroundColor Green
# Build React UI
if (-not $SkipUI) {
    Write-Host "`n[2/$steps] Building React UI..." -ForegroundColor Yellow
    Push-Location $UIDir
    try {
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "npm build failed" }
        Write-Host "  UI built to $WwwrootDir" -ForegroundColor Green
    }
    finally { Pop-Location }
} else {
    Write-Host "`n[2/$steps] Skipping UI build." -ForegroundColor DarkGray
}

# Verify wwwroot exists
if (-not (Test-Path (Join-Path $WwwrootDir "index.html"))) {
    throw "wwwroot/index.html not found. Run without -SkipUI first."
}

# Publish .NET app
if (-not $SkipPublish) {
    Write-Host "`n[3/$steps] Publishing .NET app..." -ForegroundColor Yellow
    dotnet publish "$EngineDir" -c Release -o "$PublishDir" --nologo
    if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed" }
    Write-Host "  Published to $PublishDir" -ForegroundColor Green
} else {
    Write-Host "`n[3/$steps] Skipping .NET publish." -ForegroundColor DarkGray
}

# Summary
Write-Host "`n[4/$steps] Build complete!" -ForegroundColor Green
$exe = Join-Path $PublishDir "Sentinel.exe"
if (Test-Path $exe) {
    $size = [math]::Round((Get-Item $exe).Length / 1MB, 1)
    Write-Host "  Output: $exe ($size MB)" -ForegroundColor Cyan
}

# Installer (optional)
if ($Installer) {
    Write-Host "`n[5/$steps] Building installer..." -ForegroundColor Yellow
    $issFile = Join-Path $Root "installer.iss"
    $iscc = "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
    if (-not (Test-Path $iscc)) {
        Write-Host "  Inno Setup not found at $iscc — skipping installer." -ForegroundColor DarkGray
        Write-Host "  Download from: https://jrsoftware.org/isdl.php" -ForegroundColor DarkGray
    } else {
        # Read version from csproj and pass to Inno Setup
        [xml]$csproj = Get-Content (Join-Path $EngineDir "Sentinel.Engine.csproj")
        $version = $csproj.Project.PropertyGroup.Version | Where-Object { $_ } | Select-Object -First 1
        if (-not $version) { $version = "1.0.0" }
        Write-Host "  Version: $version" -ForegroundColor DarkGray
        & $iscc "/DAppVersion=$version" $issFile
        if ($LASTEXITCODE -ne 0) { throw "Installer build failed" }
        $installerDir = Join-Path $Root "installer"
        Write-Host "  Installer built to $installerDir" -ForegroundColor Green
    }
}

Write-Host ""
