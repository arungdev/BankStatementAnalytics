$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$exporter = Join-Path $projectRoot 'Common.Framework/Deployment/Export-Deployment.ps1'
if (-not (Test-Path -LiteralPath $exporter)) {
    throw 'The private Common.Framework source checkout is required to refresh this module. Public clones use the committed deploy/common copy.'
}
& $exporter -ProjectRoot $projectRoot
Copy-Item -LiteralPath (Join-Path $projectRoot 'deploy/common/Templates/log4net.config') -Destination (Join-Path $projectRoot 'BankStatementAnalytics/log4net.config') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'deploy/common/Templates/enable-https.bat') -Destination (Join-Path $projectRoot 'enable-https.bat') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'deploy/common/Templates/setup-google-login.bat') -Destination (Join-Path $projectRoot 'setup-google-login.bat') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'deploy/common/Templates/Setup.bat') -Destination (Join-Path $projectRoot 'Setup.bat') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'deploy/common/Templates/Update.bat') -Destination (Join-Path $projectRoot 'Update.bat') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'deploy/common/Templates/Local-Docker.bat') -Destination (Join-Path $projectRoot 'Local-Docker.bat') -Force
