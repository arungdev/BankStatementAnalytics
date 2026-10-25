param([string]$Server, [int]$Port = 22, [Parameter(Mandatory=$true)][string]$ProjectRoot)
$ErrorActionPreference = 'Stop'
try {
    if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) { throw 'Install Windows OpenSSH Client first.' }
    $config = @{}
    foreach ($line in Get-Content -LiteralPath (Join-Path $ProjectRoot 'deploy/project.env')) {
        if ($line -match '^([A-Z_]+)=([A-Za-z0-9_./,:+-]*)$') { $config[$Matches[1]] = $Matches[2] }
    }
    foreach ($name in @('DEPLOY_DIRECTORY', 'APP_SERVICE', 'HTTPS_PROFILE')) {
        if ($config[$name] -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]*$') { throw "Invalid $name." }
    }
    $appPort = 0
    if (-not [int]::TryParse($config.APP_HOST_PORT, [ref]$appPort) -or $appPort -lt 1 -or $appPort -gt 65535) { throw 'Invalid APP_HOST_PORT.' }
    if (-not $Server) { $Server = Read-Host 'SSH address (example: ubuntu@203.0.113.10)' }
    if ($Server -notmatch '^[A-Za-z0-9_][A-Za-z0-9_.-]*@[A-Za-z0-9][A-Za-z0-9.-]*$') { throw 'Use user@hostname or user@IPv4.' }
    if ($Port -lt 1 -or $Port -gt 65535) { throw 'Invalid SSH port.' }
    # Only public script text crosses in argv. Credentials are entered directly
    # into the remote terminal, never captured or saved on the Windows computer.
    $script = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'configure-google.sh')).Replace("`r`n", "`n")
    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($script))
    # Avoid embedded double quotes: Windows PowerShell can remove them when
    # passing native SSH arguments. Only public helper code is staged remotely.
    $command = 't=$(mktemp /tmp/google-setup.XXXXXXXX) && printf %s ''{0}'' | base64 -d >$t && bash $t ''{1}'' ''{2}'' ''{3}'' ''{4}''; r=$?; rm -f -- $t; exit $r' -f $encoded, $config.DEPLOY_DIRECTORY, $config.APP_SERVICE, $appPort, $config.HTTPS_PROFILE
    Write-Host 'Connecting once over SSH. Enter Google credentials on the Ubuntu terminal when prompted.'
    Write-Host 'An SSH password and a separate sudo password may be required.'
    & ssh -t -o ConnectTimeout=15 -p "$Port" $Server $command
    if ($LASTEXITCODE -ne 0) { throw "Google login setup failed (SSH exit $LASTEXITCODE)." }
} catch { Write-Error $_; exit 1 }
