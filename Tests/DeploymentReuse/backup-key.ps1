$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
. "$projectRoot/deploy/common/backup-key.ps1"
$previousLocal = $env:LOCALAPPDATA
$env:LOCALAPPDATA = Join-Path $projectRoot ('.build/backup-key-test-' + [Guid]::NewGuid().ToString('N'))
try {
    $key = Get-DeploymentBackupKey -Server 'test@synthetic.invalid' -Port 22 -Directory 'testapp'
    $before = (Get-FileHash -LiteralPath $key.Path).Hash
    $again = Get-DeploymentBackupKey -Server 'test@synthetic.invalid' -Port 22 -Directory 'testapp'
    if ($again.Path -ne $key.Path -or (Get-FileHash -LiteralPath $again.Path).Hash -ne $before) { throw 'Rerun changed the recovery private key.' }
    if ((Get-Content -Raw -LiteralPath $key.PublicPath).Trim() -notmatch '^ssh-ed25519 [A-Za-z0-9+/=]+$') { throw 'Invalid public recipient.' }
    if ($key.Path.StartsWith((Join-Path $projectRoot 'Setup'),[StringComparison]::OrdinalIgnoreCase)) { throw 'Recovery key entered a distributable directory.' }
    Write-Host 'PASS: persistent recovery key is protected, reusable and outside distribution packages; only its public recipient is exported.'
} finally { $env:LOCALAPPDATA = $previousLocal }
