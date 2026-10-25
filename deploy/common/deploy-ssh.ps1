param(
    [string]$Server,
    [int]$Port = 22,
    [string]$Domain,
    [string]$Email,
    [string]$Version,
    [int]$LocalPort = 18080,
    [switch]$EnableHttpsOnly,
    [switch]$UnifiedSetup,
    [switch]$UpdateExisting,
    [Parameter(Mandatory = $true)][string]$ProjectRoot
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/ssh-auth.ps1"
$temporaryKey = $null
$temporaryKeyMayBeInstalled = $false
$sshArguments = @()
$backupKey = $null
$backupDownloadReady = $false

function Invoke-Checked {
    param([string]$Command, [string[]]$Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command failed (exit $LASTEXITCODE)." }
}

try {
    if ($UpdateExisting) { $UnifiedSetup = $true }
    $projectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
    $config = @{}
    foreach ($line in Get-Content -LiteralPath (Join-Path $projectRoot 'deploy/project.env')) {
        if (-not $line -or $line.StartsWith('#')) { continue }
        if ($line -notmatch '^([A-Z_]+)=([A-Za-z0-9_./,:+-]*)$') { throw 'Invalid project configuration.' }
        $config[$Matches[1]] = $Matches[2]
    }
    $remoteDirectory = $config.DEPLOY_DIRECTORY
    if ($remoteDirectory -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]*$') { throw 'Invalid DEPLOY_DIRECTORY.' }
    $appPort = 0
    if (-not [int]::TryParse($config.APP_HOST_PORT, [ref]$appPort) -or $appPort -lt 1 -or $appPort -gt 65535) { throw 'Invalid APP_HOST_PORT.' }
    if ($config.HTTPS_PROFILE -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]*$') { throw 'Invalid HTTPS_PROFILE.' }
    if (-not $Version) { $Version = $config.DEPLOY_VERSION }
    $requiredCommands = if ($EnableHttpsOnly) { @('ssh') } else { @('ssh', 'scp', 'ssh-keygen') }
    foreach ($command in $requiredCommands) {
        if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
            throw 'Install Windows OpenSSH Client from Optional Features, then run this launcher again.'
        }
    }
    if (-not $Server) { $Server = Read-Host 'SSH address (sample: ubuntu@203.0.113.10)' }
    if ($Server -notmatch '^[A-Za-z0-9_][A-Za-z0-9_.-]*@[A-Za-z0-9][A-Za-z0-9.-]*$') {
        throw 'Use an SSH address in user@hostname or user@IPv4 format.'
    }
    if ($Port -lt 1 -or $Port -gt 65535) { throw 'SSH port must be between 1 and 65535.' }
    if ($EnableHttpsOnly) {
        $elevate = if ($Server.StartsWith('root@')) { '' } else { 'sudo ' }
        $remoteCommand = "cd ~/$remoteDirectory && if test -f .google-enabled; then ${elevate}docker compose -f docker-compose.yml -f deploy/google-compose.yml --profile $($config.HTTPS_PROFILE) up -d --no-build --wait --wait-timeout 180; else ${elevate}docker compose --profile $($config.HTTPS_PROFILE) up -d --no-build --wait --wait-timeout 180; fi"
        Invoke-Checked -Command 'ssh' -Arguments @('-t', '-p', "$Port", '-o', 'ConnectTimeout=15', $Server, $remoteCommand)
        Write-Host 'HTTPS started using the existing server configuration.'
        return
    }
    if (-not $UpdateExisting -and -not $Domain) { $Domain = Read-Host 'Domain pointing to your server (sample: billing.example.com; no https://)' }
    if (-not $UpdateExisting -and -not $Email) { $Email = Read-Host 'HTTPS certificate email (sample: admin@example.com)' }
    if ($LocalPort -lt 1 -or $LocalPort -gt 65535) { throw 'Local tunnel port must be between 1 and 65535.' }
    if (-not $UpdateExisting -and $Domain -notmatch '^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$') {
        throw 'Enter a domain name without https://, a path, or a port.'
    }
    if (-not $UpdateExisting -and $Email -notmatch '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$') { throw 'Enter a valid certificate email address.' }
    if ($Version -notmatch '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$') { throw 'Invalid Docker image tag.' }
    if ($UnifiedSetup) {
        . "$PSScriptRoot/backup-key.ps1"
        $backupKey = Get-DeploymentBackupKey -Server $Server -Port $Port -Directory $remoteDirectory
        Write-Host "Backup recovery private key (keep a secure copy): $($backupKey.Path)"
        Write-Host 'Only its public key is sent to Ubuntu. The private key stays on this computer.'
        Write-Host 'SSH password sample: your Ubuntu login password (hidden); sudo may ask for it separately.'
        Write-Host 'First SSH connection: verify the server fingerprint, then type yes when asked (sample: yes).'
    }

    Write-Host 'Checking existing SSH key authentication...'
    if (-not (Test-DeploymentKeyAuthentication -Server $Server -Port $Port)) {
        Write-Host 'Enter your SSH password once to authorize a temporary deployment key.'
        Write-Host 'The temporary key is removed afterwards; your password is never stored.'
        $temporaryKey = New-DeploymentSshKey
        $temporaryKeyMayBeInstalled = $true
        Invoke-Checked -Command 'ssh' -Arguments @('-p', "$Port", $Server,
            (Get-DeploymentKeyInstallCommand -PublicKey $temporaryKey.PublicKey))
        $sshArguments = @('-i', $temporaryKey.Path, '-o', 'IdentitiesOnly=yes')
    }
    $sshArguments += @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3')
    Invoke-Checked -Command 'ssh' -Arguments ($sshArguments + @('-p', "$Port", $Server, "mkdir -p ~/$remoteDirectory/deploy ~/$remoteDirectory/images"))
    Invoke-Checked -Command 'scp' -Arguments ($sshArguments + @('-P', "$Port", (Join-Path $projectRoot 'docker-compose.yml'), "${Server}:$remoteDirectory/docker-compose.next.yml"))
    Invoke-Checked -Command 'scp' -Arguments ($sshArguments + @('-P', "$Port", '-r', (Join-Path $projectRoot 'deploy'), "${Server}:$remoteDirectory/"))
    if ($UnifiedSetup) {
        Invoke-Checked -Command 'scp' -Arguments ($sshArguments + @('-P', "$Port", $backupKey.PublicPath, "${Server}:$remoteDirectory/backup-recipient.pending.pub"))
        Invoke-Checked -Command 'ssh' -Arguments ($sshArguments + @('-p', "$Port", $Server, "mkdir -p ~/$remoteDirectory/.deployment-transfer && chmod 700 ~/$remoteDirectory/.deployment-transfer && rm -f ~/$remoteDirectory/.deployment-transfer/latest-snapshot.tar.age"))
        $backupDownloadReady = $true
    }
    $imageArchive = Join-Path $projectRoot 'application-image.tar'
    if (Test-Path -LiteralPath $imageArchive -PathType Leaf) {
        Write-Host 'Uploading the bundled Docker image. This can take a few minutes.'
        Invoke-Checked -Command 'scp' -Arguments ($sshArguments + @('-P', "$Port", $imageArchive, "${Server}:$remoteDirectory/images/application-$Version.tar"))
    }
    $LocalPort = Get-DeploymentLocalPort -PreferredPort $LocalPort
    Write-Host "Setup tunnel: http://localhost:$LocalPort (kept open automatically)"
    Write-Host 'Installing/starting on Ubuntu. A sudo password may be required separately.'
    $remoteCommand = "cd ~/$remoteDirectory && bash deploy/common/session-deploy.sh '$Domain' '$Email' '$Version' '$LocalPort'"
    if ($UpdateExisting) {
        $remoteCommand = "cd ~/$remoteDirectory && sudo bash deploy/common/update-existing.sh '$Version' '$LocalPort'"
    } elseif ($UnifiedSetup) { $remoteCommand += ' unified' }
    Invoke-Checked -Command 'ssh' -Arguments ($sshArguments + @('-t', '-o', 'ExitOnForwardFailure=yes',
        '-L', "127.0.0.1:${LocalPort}:127.0.0.1:$appPort", '-p', "$Port", $Server, $remoteCommand))
    if ($UpdateExisting) { Write-Host 'Update complete. Open your existing HTTPS application address.' }
    else { Write-Host "Deployment session complete. If HTTPS was enabled, open https://$Domain" }
} catch {
    Write-Error $_ -ErrorAction Continue
    exit 1
} finally {
    $cleanupPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        if ($backupDownloadReady -and $backupKey) {
            $destination = Join-Path $env:LOCALAPPDATA ("CommonDeployment/Backups/$($backupKey.Identity)/" + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
            New-Item -ItemType Directory -Force -Path $destination > $null
            & scp @sshArguments -P "$Port" "${Server}:$remoteDirectory/.deployment-transfer/latest-snapshot.tar.age" $destination
            if ($LASTEXITCODE -eq 0) { Write-Host "Encrypted pre-upgrade backup downloaded: $destination" }
            else { Write-Warning 'No upgrade backup was downloaded. A fresh installation has none; on upgrade, inspect the server backups folder.' }
        }
        if ($temporaryKeyMayBeInstalled -and $temporaryKey) {
            & ssh -i $temporaryKey.Path -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=10 -p "$Port" $Server (Get-DeploymentKeyRemoveCommand -Comment $temporaryKey.Comment)
            if ($LASTEXITCODE -ne 0) {
                Write-Warning "Could not remove temporary public key '$($temporaryKey.Comment)' from the server. The local private key will be deleted."
            }
        }
    } finally {
        $ErrorActionPreference = $cleanupPreference
        Remove-DeploymentSshKey -Key $temporaryKey
    }
}
