$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$global:GoogleSetupCalls = [Collections.Generic.List[object]]::new()
function global:ssh {
    $global:GoogleSetupCalls.Add(@($args))
    $global:LASTEXITCODE = 0
}
try {
    & "$projectRoot/deploy/setup-google-ssh.ps1" -Server 'tester@synthetic.invalid' -Port 2222
    if ($global:GoogleSetupCalls.Count -ne 1) { throw 'Expected exactly one SSH connection.' }
    $arguments = $global:GoogleSetupCalls[0]
    if ($arguments -notcontains '-t' -or $arguments -notcontains '2222' -or $arguments -notcontains 'tester@synthetic.invalid') { throw 'Missing SSH terminal, port or server.' }
    $command = $arguments[-1]
    if ($command -notmatch "printf %s '([A-Za-z0-9+/=]+)' \| base64 -d") { throw 'Missing encoded public remote script.' }
    $decoded = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Matches[1]))
    $expected = [IO.File]::ReadAllText("$projectRoot/deploy/common/configure-google.sh").Replace("`r`n", "`n")
    if ($decoded -cne $expected) { throw 'Remote script changed in transit.' }
    if ($command -notmatch 'bash \$t ''bankstatementanalytics'' ''bankstatementanalytics'' ''8080'' ''https'';') { throw 'Project configuration was not passed safely.' }
    if ($command.Contains('"')) { throw 'Remote command depends on native double-quote preservation.' }
    if ($decoded -notmatch "read -r -s -p 'Google Client Secret" -or $decoded -notmatch 'api/auth/options') { throw 'Missing hidden input or upgrade check.' }
    Write-Host 'PASS: one interactive SSH connection, configured port, exact public payload and project arguments.'
    Write-Host 'PASS: remote helper checks upgrade support and prompts for the secret without local credential capture.'
} finally { Remove-Item Function:\ssh -ErrorAction SilentlyContinue }
