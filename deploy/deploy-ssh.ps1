param(
    [string]$Server,
    [int]$Port = 22,
    [string]$Domain,
    [string]$Email,
    [string]$Version = '3.1.0-linux-1da6c7b'
)
$ErrorActionPreference = 'Stop'

function Invoke-Checked {
    param([string]$Command, [string[]]$Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command failed (exit $LASTEXITCODE)." }
}

try {
    foreach ($command in @('ssh', 'scp')) {
        if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
            throw 'Install Windows OpenSSH Client from Optional Features, then run this launcher again.'
        }
    }
    if (-not $Server) { $Server = Read-Host 'SSH address (example: ubuntu@203.0.113.10)' }
    if (-not $Domain) { $Domain = Read-Host 'Application domain pointing to this server (example: billing.example.com)' }
    if (-not $Email) { $Email = Read-Host 'Email for HTTPS certificates' }
    if ($Server -notmatch '^[A-Za-z0-9_][A-Za-z0-9_.-]*@[A-Za-z0-9][A-Za-z0-9.-]*$') {
        throw 'Use an SSH address in user@hostname or user@IPv4 format.'
    }
    if ($Port -lt 1 -or $Port -gt 65535) { throw 'SSH port must be between 1 and 65535.' }
    if ($Domain -notmatch '^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$') {
        throw 'Enter a domain name without https://, a path, or a port.'
    }
    if ($Email -notmatch '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$') { throw 'Enter a valid certificate email address.' }
    if ($Version -notmatch '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$') { throw 'Invalid Docker image tag.' }

    $projectRoot = Split-Path $PSScriptRoot -Parent
    $elevate = if ($Server.StartsWith('root@')) { '' } else { 'sudo ' }
    Write-Host 'Connecting over SSH. SSH may ask you to verify the server fingerprint and enter your password.'
    Invoke-Checked -Command 'ssh' -Arguments @('-p', "$Port", $Server, 'mkdir -p ~/bankstatementanalytics/deploy')
    Invoke-Checked -Command 'scp' -Arguments @('-P', "$Port", (Join-Path $projectRoot 'docker-compose.yml'), "${Server}:bankstatementanalytics/docker-compose.next.yml")
    Invoke-Checked -Command 'scp' -Arguments @('-P', "$Port", '-r', $PSScriptRoot, "${Server}:bankstatementanalytics/")
    Write-Host 'Installing/starting on Ubuntu. sudo may request the server password.'
    $remoteCommand = "cd ~/bankstatementanalytics && ${elevate}bash deploy/server-deploy.sh '$Domain' '$Email' '$Version'"
    Invoke-Checked -Command 'ssh' -Arguments @('-t', '-p', "$Port", $Server, $remoteCommand)

    Write-Host ''
    Write-Host 'Complete first-admin setup before enabling public HTTPS:'
    Write-Host "  1. In another terminal run: ssh -p $Port -L 18080:127.0.0.1:8080 $Server"
    Write-Host '  2. Open http://localhost:18080 and create the first administrator.'
    $answer = Read-Host 'After setup is complete, type ENABLE to start public HTTPS (anything else leaves it private)'
    if ($answer -ceq 'ENABLE') {
        Invoke-Checked -Command 'ssh' -Arguments @('-t', '-p', "$Port", $Server,
            "cd ~/bankstatementanalytics && ${elevate}docker compose --profile https up -d --no-build --wait --wait-timeout 180")
        Write-Host "Deployment ready: https://$Domain"
    } else {
        Write-Host 'Use the SSH tunnel to access the application. Existing proxy settings are unchanged.'
    }
} catch {
    Write-Error $_ -ErrorAction Continue
    exit 1
}
