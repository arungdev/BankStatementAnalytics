$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$global:DeployTestCalls = [Collections.Generic.List[object]]::new()
$global:DeployTestNeedsPassword = $false
$fixture = Join-Path $projectRoot ('.build/ssh-launcher-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $fixture 'deploy') -Force > $null
Copy-Item -LiteralPath (Join-Path $projectRoot 'deploy/project.env') -Destination (Join-Path $fixture 'deploy/project.env')
[IO.File]::WriteAllText((Join-Path $fixture 'application-image.tar'), 'Synthetic test archive; never loaded')
function global:ssh {
    $global:DeployTestCalls.Add(@{ Tool = 'ssh'; Arguments = @($args) })
    $global:LASTEXITCODE = if ($global:DeployTestNeedsPassword -and $args[-1] -eq 'true') { 255 } else { 0 }
}
function global:scp {
    $global:DeployTestCalls.Add(@{ Tool = 'scp'; Arguments = @($args) })
    $global:LASTEXITCODE = 0
}
try {
    & (Join-Path $projectRoot 'deploy/common/deploy-ssh.ps1') -ProjectRoot $projectRoot -Server 'tester@deployment-test.invalid' -EnableHttpsOnly
    $httpsCalls = @($global:DeployTestCalls.ToArray())
    if ($httpsCalls.Count -ne 1 -or $httpsCalls[0].Tool -ne 'ssh' -or
        ($httpsCalls[0].Arguments -join ' ') -notmatch 'sudo docker compose --profile https up -d --no-build --wait --wait-timeout 180') {
        throw 'HTTPS-only launcher must run just the existing server Compose command.'
    }
    Write-Host 'PASS: HTTPS-only mode starts the proxy in one SSH connection without file uploads or redeployment.'
    foreach ($needsPassword in @($false, $true)) {
        $global:DeployTestNeedsPassword = $needsPassword
        $global:DeployTestCalls.Clear()
        $deployRoot = if ($needsPassword) { $fixture } else { $projectRoot }
        & (Join-Path $projectRoot 'deploy/common/deploy-ssh.ps1') -ProjectRoot $deployRoot -Server 'root@deployment-test.invalid' -Domain 'deployment.example.com' -Email 'test@example.com'
        $calls = @($global:DeployTestCalls.ToArray())
        $interactive = @($calls | Where-Object { $_.Tool -eq 'ssh' -and $_.Arguments -notcontains 'BatchMode=yes' })
        if ($interactive.Count -ne [int]$needsPassword) { throw 'SSH login can prompt more than once.' }
        $sessions = @($calls | Where-Object { $_.Tool -eq 'ssh' -and ($_.Arguments -join ' ') -match 'session-deploy.sh' })
        if ($sessions.Count -ne 1 -or $sessions[0].Arguments -notcontains '-L' -or $sessions[0].Arguments -notcontains '-t') {
            throw 'Installation, setup forwarding and HTTPS must share one SSH session.'
        }
        foreach ($copy in @($calls | Where-Object Tool -eq 'scp')) {
            if ($copy.Arguments -notcontains 'BatchMode=yes') { throw 'File transfer can prompt for a login password.' }
        }
        if ($needsPassword) {
            $imageCopies = @($calls | Where-Object { $_.Tool -eq 'scp' -and ($_.Arguments -join ' ') -match 'images/application-' })
            if ($imageCopies.Count -ne 1) { throw 'Bundled image must be uploaded using the authenticated connection.' }
            if ($imageCopies[0].Arguments[-1] -notmatch '\.tar\.partial$') { throw 'Image must be uploaded to a temporary path.' }
            $integrityChecks = @($calls | Where-Object { $_.Tool -eq 'ssh' -and ($_.Arguments -join ' ') -match 'sha256sum -c' })
            if ($integrityChecks.Count -ne 1) { throw 'Transferred image must be verified before use.' }
            $cleanup = @($calls | Where-Object { $_.Tool -eq 'ssh' -and ($_.Arguments -join ' ') -match 'sed -i' })
            if ($cleanup.Count -ne 1) { throw 'Temporary server key cleanup was not attempted.' }
            $identityIndex = [Array]::IndexOf($cleanup[0].Arguments, '-i')
            if (Test-Path -LiteralPath $cleanup[0].Arguments[$identityIndex + 1]) { throw 'Temporary local identity remains after deployment.' }
        }
        Write-Host "PASS: mocked SSH deployment reuses authentication and one tunnel/session (password bootstrap=$needsPassword)."
    }
    $previousLocal = $env:LOCALAPPDATA
    try {
        $env:LOCALAPPDATA = Join-Path $fixture 'local-user-profile'
        $global:DeployTestNeedsPassword = $false
        $global:DeployTestCalls.Clear()
        & (Join-Path $projectRoot 'deploy/common/deploy-ssh.ps1') -ProjectRoot $projectRoot -Server 'root@deployment-test.invalid' -Domain 'deployment.example.com' -Email 'test@example.com' -UnifiedSetup
        $calls = @($global:DeployTestCalls.ToArray())
        $session = @($calls | Where-Object { $_.Tool -eq 'ssh' -and ($_.Arguments -join ' ') -match 'session-deploy.sh' })
        if ($session.Count -ne 1 -or ($session[0].Arguments -join ' ') -notmatch ' unified$') { throw 'Unified setup did not share the main SSH session.' }
        $recipientCopy = @($calls | Where-Object { $_.Tool -eq 'scp' -and ($_.Arguments -join ' ') -match 'backup-recipient.pending.pub' })
        if ($recipientCopy.Count -ne 1 -or $recipientCopy[0].Arguments[-2] -notmatch '\.pub$') { throw 'Only the recovery public key may be uploaded.' }
        foreach ($call in @($calls | Where-Object Tool -eq 'scp')) {
            if (($call.Arguments -join ' ') -match 'recovery-ed25519(?:\s|$)') { throw 'Private recovery key entered SCP arguments.' }
        }
        Write-Host 'PASS: unified setup uploads only a public recovery recipient, keeps the private key local and uses the same tunneled SSH session.'
        $global:DeployTestCalls.Clear()
        & (Join-Path $projectRoot 'deploy/common/deploy-ssh.ps1') -ProjectRoot $projectRoot -Server 'root@deployment-test.invalid' -UpdateExisting
        $updates = @($global:DeployTestCalls.ToArray() | Where-Object { $_.Tool -eq 'ssh' -and ($_.Arguments -join ' ') -match 'update-existing.sh' })
        if ($updates.Count -ne 1 -or $updates[0].Arguments -notcontains '-t') { throw 'Existing-server update did not use the saved-settings helper.' }
        Write-Host 'PASS: existing-server update needs no domain, certificate email or Google credential input.'
    } finally { $env:LOCALAPPDATA = $previousLocal }
} finally {
    Remove-Item Function:\ssh,Function:\scp -ErrorAction SilentlyContinue
    Remove-Variable DeployTestCalls,DeployTestNeedsPassword -Scope Global -ErrorAction SilentlyContinue
}
