$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this script from an elevated PowerShell window.'
}

$installRoot = 'C:\Program Files\Bank Statement Analytics'
$publishRoot = Join-Path $PSScriptRoot '.build\GPayDuplicateFix'
$serviceName = 'BankStatementAnalytics'
$backupRoot = Join-Path $PSScriptRoot ('backups\gpay-fix-rollback-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$installedExe = Join-Path $installRoot 'BankStatementAnalytics.exe'
$publishedExe = Join-Path $publishRoot 'BankStatementAnalytics.exe'
$installedWeb = Join-Path $installRoot 'wwwroot'
$publishedWeb = Join-Path $publishRoot 'wwwroot'

function Copy-WithRetry([string]$Source, [string]$Destination, [int]$Attempts = 20) {
    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        try {
            Copy-Item -LiteralPath $Source -Destination $Destination -Force
            return
        }
        catch {
            if ($attempt -eq $Attempts) { throw }
            Start-Sleep -Seconds 1
        }
    }
}

function Wait-ForProcessExit([int]$ProcessId, [int]$TimeoutSeconds = 45) {
    if ($ProcessId -le 0) { return }
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) { return }
        Start-Sleep -Milliseconds 500
    }
    throw "Service process $ProcessId did not exit after it stopped."
}

function Wait-ForHttp([string]$Uri, [int]$TimeoutSeconds = 120) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $lastError = 'No response yet.'
    while ([DateTime]::UtcNow -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $Uri -TimeoutSec 5 -UseBasicParsing
            if ([int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 500) { return $response }
            $lastError = "HTTP $([int]$response.StatusCode)."
        }
        catch { $lastError = $_.Exception.Message }
        Start-Sleep -Seconds 3
    }
    throw "App did not respond within $TimeoutSeconds seconds: $lastError"
}

if (-not (Test-Path -LiteralPath $installedExe) -or -not (Test-Path -LiteralPath $publishedExe)) {
    throw 'The installed or staged application executable is missing.'
}
if (-not (Test-Path -LiteralPath $installedWeb) -or -not (Test-Path -LiteralPath $publishedWeb)) {
    throw 'The installed or staged web files are missing.'
}

New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
Copy-Item -LiteralPath $installedExe -Destination (Join-Path $backupRoot 'BankStatementAnalytics.exe')
Copy-Item -LiteralPath $installedWeb -Destination (Join-Path $backupRoot 'wwwroot') -Recurse
$originalExeHash = (Get-FileHash -LiteralPath $installedExe -Algorithm SHA256).Hash

try {
    $serviceProcessId = (Get-CimInstance Win32_Service -Filter "Name='$serviceName'").ProcessId
    Stop-Service -Name $serviceName
    (Get-Service -Name $serviceName).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(45))
    Wait-ForProcessExit -ProcessId $serviceProcessId
    Start-Sleep -Seconds 2

    Copy-WithRetry -Source $publishedExe -Destination $installedExe
    Copy-Item -Path (Join-Path $publishedWeb '*') -Destination $installedWeb -Recurse -Force

    Start-Service -Name $serviceName
    (Get-Service -Name $serviceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(60))
    $health = Wait-ForHttp -Uri 'http://127.0.0.1:5080/'

    Write-Output "Updated service is healthy (HTTP $([int]$health.StatusCode))."
    Write-Output "Rollback files: $backupRoot"
    Write-Output 'GPay folder auto-import remains paused. Re-enable it in GPay settings after confirming the updated app.'
}
catch {
    $deploymentError = $_.Exception.Message
    try {
        if ((Get-Service -Name $serviceName).Status -eq 'Running') {
            $serviceProcessId = (Get-CimInstance Win32_Service -Filter "Name='$serviceName'").ProcessId
            Stop-Service -Name $serviceName
            (Get-Service -Name $serviceName).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(45))
            Wait-ForProcessExit -ProcessId $serviceProcessId
        }
        $currentExeHash = if (Test-Path -LiteralPath $installedExe) { (Get-FileHash -LiteralPath $installedExe -Algorithm SHA256).Hash } else { '' }
        if ($currentExeHash -ne $originalExeHash) {
            Copy-WithRetry -Source (Join-Path $backupRoot 'BankStatementAnalytics.exe') -Destination $installedExe
        }
        Copy-Item -Path (Join-Path $backupRoot 'wwwroot\*') -Destination $installedWeb -Recurse -Force
        Start-Service -Name $serviceName
        (Get-Service -Name $serviceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(60))
        $null = Wait-ForHttp -Uri 'http://127.0.0.1:5080/'
        Write-Output "The previous app was restored after this update error: $deploymentError"
    }
    catch {
        Write-Output "Rollback needs attention: $($_.Exception.Message)"
    }
    throw
}
