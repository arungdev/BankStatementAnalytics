$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$exporter = Join-Path $projectRoot 'Common.Framework/Deployment/Export-Deployment.ps1'
if (-not (Test-Path -LiteralPath $exporter)) {
    throw 'The private Common.Framework source checkout is required to refresh this module. Public clones use the committed deploy/common copy.'
}
& $exporter -ProjectRoot $projectRoot
Copy-Item -LiteralPath (Join-Path $projectRoot 'deploy/common/Templates/log4net.config') -Destination (Join-Path $projectRoot 'BankStatementAnalytics/log4net.config') -Force
