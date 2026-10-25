function Get-DeploymentBackupKey {
    param([string]$Server, [int]$Port, [string]$Directory)
    $hashAlgorithm = [Security.Cryptography.SHA256]::Create()
    try { $identity = ([BitConverter]::ToString($hashAlgorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes("${Server}:${Port}/$Directory")))).Replace('-','').ToLowerInvariant() }
    finally { $hashAlgorithm.Dispose() }
    $root = Join-Path $env:LOCALAPPDATA "CommonDeployment/BackupKeys/$identity"
    New-Item -ItemType Directory -Force -Path $root > $null
    $key = Join-Path $root 'recovery-ed25519'
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & icacls.exe $root /inheritance:r /grant:r "*${sid}:(OI)(CI)(F)" > $null
    if ($LASTEXITCODE -ne 0) { throw 'Could not protect the local backup-key directory.' }
    if (-not (Test-Path -LiteralPath $key)) {
        $process = Start-Process -FilePath (Get-Command ssh-keygen).Source -ArgumentList @(
            '-q','-t','ed25519','-N','""','-C','common-backup-recovery','-f',('"' + $key + '"')
        ) -WindowStyle Hidden -Wait -PassThru
        if ($process.ExitCode -ne 0) { throw 'Could not create the backup recovery key.' }
    }
    & icacls.exe $key /inheritance:r /grant:r "*${sid}:(F)" > $null
    if ($LASTEXITCODE -ne 0) { throw 'Could not protect the backup private key.' }
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = (Get-Command ssh-keygen).Source
    $start.Arguments = '-y -P "" -f "' + $key + '"'
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $derived = [Diagnostics.Process]::Start($start)
    $public = $derived.StandardOutput.ReadToEnd().Trim()
    $errorText = $derived.StandardError.ReadToEnd()
    $derived.WaitForExit()
    if ($derived.ExitCode -ne 0 -or $public -notmatch '^ssh-ed25519 ([A-Za-z0-9+/=]+)(?: .*)?$') { throw 'The backup recovery key is invalid or unreadable.' }
    $public = 'ssh-ed25519 ' + $Matches[1]
    [IO.File]::WriteAllText($key + '.pub', $public + "`n", [Text.UTF8Encoding]::new($false))
    return @{ Path = $key; PublicPath = ($key + '.pub'); Identity = $identity }
}
