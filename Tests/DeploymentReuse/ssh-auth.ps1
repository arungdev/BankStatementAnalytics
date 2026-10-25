$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
. (Join-Path $projectRoot 'deploy/common/ssh-auth.ps1')
$key = $null
try {
    $key = New-DeploymentSshKey
    if (-not (Test-Path -LiteralPath $key.Path)) { throw 'Temporary identity was not created.' }
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = (Get-Command ssh-keygen).Source
    $start.Arguments = '-y -P "" -f "' + $key.Path + '"'
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $process = [Diagnostics.Process]::Start($start)
    $derived = $process.StandardOutput.ReadToEnd()
    $errorText = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0 -or $derived -notmatch '^ssh-ed25519 ') { throw 'Generated key could not be used without a passphrase.' }
    $install = Get-DeploymentKeyInstallCommand -PublicKey $key.PublicKey
    if ($install -notmatch 'authorized_keys' -or $install -notmatch [regex]::Escape($key.Comment)) { throw 'Temporary key installation command is incomplete.' }
    $remove = Get-DeploymentKeyRemoveCommand -Comment $key.Comment
    if ($remove -notmatch [regex]::Escape($key.Comment) -or $remove -notmatch '\$\|d') { throw 'Cleanup must match only the temporary key comment at line end.' }
    $rejected = $false
    try { Get-DeploymentKeyRemoveCommand -Comment 'unsafe;command' } catch { $rejected = $true }
    if (-not $rejected) { throw 'Unsafe key comment accepted.' }
    Write-Host 'PASS: temporary Ed25519 key, empty passphrase, bounded cleanup command and input validation.'
} finally { Remove-DeploymentSshKey -Key $key }
if ($key -and (Test-Path -LiteralPath $key.Directory)) { throw 'Temporary private key directory was not removed.' }
Write-Host 'PASS: local temporary private key and public key are removed.'
