function Test-DeploymentKeyAuthentication {
    param([string]$Server, [int]$Port)
    $previousPreference = $ErrorActionPreference
    try {
        # Windows PowerShell 5.1 can turn redirected native stderr into errors.
        $ErrorActionPreference = 'Continue'
        & ssh -o BatchMode=yes -o ConnectTimeout=10 -p "$Port" $Server true > $null 2>$null
        return $LASTEXITCODE -eq 0
    } finally { $ErrorActionPreference = $previousPreference }
}

function New-DeploymentSshKey {
    $directory = Join-Path ([IO.Path]::GetTempPath()) ('common-deploy-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $directory > $null
    $key = Join-Path $directory 'identity'
    $comment = 'common-deploy-' + [Guid]::NewGuid().ToString('N')
    try {
        # Start-Process preserves the empty passphrase on Windows PowerShell 5.1 too.
        $process = Start-Process -FilePath (Get-Command ssh-keygen).Source -ArgumentList @(
            '-q', '-t', 'ed25519', '-N', '""', '-C', $comment, '-f', ('"' + $key + '"')
        ) -WindowStyle Hidden -Wait -PassThru
        if ($process.ExitCode -ne 0) { throw 'Could not generate the temporary SSH key.' }
        $publicKey = (Get-Content -Raw -LiteralPath ($key + '.pub')).Trim()
        if ($publicKey -notmatch ('^ssh-ed25519 [A-Za-z0-9+/=]+ ' + $comment + '$')) { throw 'Unexpected public-key format.' }
        return @{ Directory = $directory; Path = $key; PublicKey = $publicKey; Comment = $comment }
    } catch {
        Remove-Item -LiteralPath $key,($key + '.pub') -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $directory -Force -ErrorAction SilentlyContinue
        throw
    }
}

function Remove-DeploymentSshKey {
    param($Key)
    if (-not $Key) { return }
    # Delete only the two files this invocation created; never recurse through .ssh.
    Remove-Item -LiteralPath $Key.Path,($Key.Path + '.pub') -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $Key.Directory -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $Key.Path) { Write-Warning "Could not delete temporary private key: $($Key.Path). Delete this file manually." }
}

function Get-DeploymentKeyInstallCommand {
    param([string]$PublicKey)
    if ($PublicKey -notmatch '^ssh-ed25519 [A-Za-z0-9+/=]+ common-deploy-[a-f0-9]{32}$') { throw 'Invalid temporary public key.' }
    return "umask 077; mkdir -p ~/.ssh && chmod 700 ~/.ssh && printf '\n%s\n' '$PublicKey' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
}

function Get-DeploymentKeyRemoveCommand {
    param([string]$Comment)
    if ($Comment -notmatch '^common-deploy-[a-f0-9]{32}$') { throw 'Invalid temporary key identifier.' }
    return "if test -f ~/.ssh/authorized_keys; then sed -i '\| $Comment`$|d' ~/.ssh/authorized_keys; fi"
}

function Get-DeploymentLocalPort {
    param([int]$PreferredPort)
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $PreferredPort)
    try {
        try { $listener.Start() }
        catch [Net.Sockets.SocketException] {
            $listener.Stop()
            $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
            $listener.Start()
        }
        return $listener.LocalEndpoint.Port
    } finally { $listener.Stop() }
}
