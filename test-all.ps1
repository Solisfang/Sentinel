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

Write-Host "Running Sentinel UI tests..." -ForegroundColor Cyan
Push-Location "Sentinel.UI"
try {
    npm test
}
finally {
    Pop-Location
}
