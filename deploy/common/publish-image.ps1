param(
    [Parameter(Position=0)][string]$Version,
    [Parameter(Position=1)][string]$Repository,
    [Parameter(Mandatory=$true)][string]$ProjectRoot
)
$ErrorActionPreference = 'Stop'
$config = @{}
Get-Content -LiteralPath (Join-Path $ProjectRoot 'deploy/project.env') | ForEach-Object {
    if ($_ -match '^([A-Z_]+)=([A-Za-z0-9_./,:+-]*)$') { $config[$Matches[1]] = $Matches[2] }
}
if ($Repository -and -not $Version) { throw 'Supply a new unique version tag before publishing.' }
if (-not $Version) { $Version = 'local' }
if ($Version -notmatch '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$') { throw 'Invalid image tag.' }
$image = if ($Repository) { $Repository } else { $config.APP_SERVICE }
if ($image -notmatch '^[a-z0-9][a-z0-9._:/-]*$') { throw 'Invalid image repository.' }
Push-Location -LiteralPath $ProjectRoot
try {
    & docker build -t "${image}:$Version" .
    if ($LASTEXITCODE -ne 0) { throw 'Docker build failed.' }
    if ($Repository) {
        & docker push "${image}:$Version"
        if ($LASTEXITCODE -ne 0) { throw 'Docker push failed.' }
    }
} finally { Pop-Location }
