param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release",
    [switch]$NoBuild
)

$ErrorActionPreference = "Stop"

Write-Host "Running Sentinel engine tests..." -ForegroundColor Cyan
$dotnetArgs = @("test", "Sentinel.Engine.Tests/Sentinel.Engine.Tests.csproj", "-c", $Configuration)
if ($NoBuild) {
    $dotnetArgs += "--no-build"
}

dotnet @dotnetArgs
if ($LASTEXITCODE -ne 0) {
    Write-Host "Engine tests failed!" -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host "Running Sentinel UI tests..." -ForegroundColor Cyan
Push-Location "Sentinel.UI"
try {
    npm test
    if ($LASTEXITCODE -ne 0) {
        Write-Host "UI tests failed!" -ForegroundColor Red
        exit $LASTEXITCODE
    }
}
finally {
    Pop-Location
}

Write-Host "All tests passed!" -ForegroundColor Green
