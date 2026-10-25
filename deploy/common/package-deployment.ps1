param([Parameter(Mandatory=$true)][string]$ProjectRoot, [string]$Destination)
$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
if (-not $Destination) { $Destination = Join-Path $ProjectRoot 'Setup/SSH-Deployment.zip' }
$destinationParent = Split-Path $Destination -Parent
if ($destinationParent) { New-Item -ItemType Directory -Force -Path $destinationParent > $null }
$paths = @('deploy-ssh.bat', 'docker-compose.yml', 'deploy') | ForEach-Object { Join-Path $ProjectRoot $_ }
if (Test-Path -LiteralPath (Join-Path $ProjectRoot '.env.example')) { $paths += Join-Path $ProjectRoot '.env.example' }
# Deliberately include only release files, never .env, secrets, backups or source data.
Compress-Archive -LiteralPath $paths -DestinationPath $Destination -Force
Write-Host "Created $Destination"
