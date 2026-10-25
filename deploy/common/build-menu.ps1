param([Parameter(Mandatory=$true)][string]$ProjectRoot, [Parameter(Mandatory=$true)][string]$ConfigFile, [switch]$PlanOnly)
$ErrorActionPreference = 'Stop'
function Read-BuildChoice([string]$Prompt, [string[]]$Allowed, [string]$Default) {
    while ($true) {
        $answer = (Read-Host $Prompt).Trim().ToLowerInvariant()
        if (-not $answer) { $answer = $Default }
        if ($Allowed -contains $answer) { return $answer }
        Write-Host ('Choose ' + ($Allowed -join ', ') + '.')
    }
}
$config = Import-PowerShellDataFile -LiteralPath $ConfigFile
$projectPath = Join-Path $ProjectRoot $config.ProjectFile
$current = @(([xml](Get-Content -Raw $projectPath)).Project.PropertyGroup.Version | Where-Object { $_ })[0]
Write-Host "`n$($config.ProductName) - Build options"
Write-Host "Current version: $current"
Write-Host "Docker repository: $($config.DockerRepository)"
Write-Host 'Output: Windows installer EXE, portable ZIP and online cloud setup ZIP.'
Write-Host '1 = Local build (no upload), 2 = Build and publish to Docker Hub, 0 = Exit'
$mode = Read-BuildChoice 'Build mode (sample: 1; Enter=1)' @('0','1','2') '1'
if ($mode -eq '0') { return }
$selection = @{ ProjectRoot=$ProjectRoot; ConfigFile=$ConfigFile; Publish=($mode -eq '2') }
Write-Host '1 = Keep current version, 2 = Next unused version when publishing, 3 = Enter version'
$defaultVersion = if ($mode -eq '2') { '2' } else { '1' }
$versionMode = Read-BuildChoice "Version option (sample: 1; Enter=$defaultVersion)" @('1','2','3') $defaultVersion
if ($versionMode -eq '2' -and $mode -ne '2') { throw 'Automatic unused version selection requires publishing. Choose keep or enter a version for local builds.' }
$selection.KeepVersion = $versionMode -ne '2'
if ($versionMode -eq '3') {
    do {
        $requested = (Read-Host 'Application version (sample: 4.0.0)').Trim()
        if ($requested -notmatch '^\d+\.\d+\.\d+$') { Write-Host 'Enter three numbers, such as 4.0.0.' }
    } while ($requested -notmatch '^\d+\.\d+\.\d+$')
    $selection.Version = $requested
}
$selection.Offline = (Read-BuildChoice 'Also create offline cloud ZIP with Docker image? (sample: n; Enter=n)' @('y','n') 'n') -eq 'y'
$selection.ExportImage = $selection.Offline -or ((Read-BuildChoice 'Also save Docker image as a TAR file? (sample: n; Enter=n)' @('y','n') 'n') -eq 'y')
if ($mode -eq '2') { Write-Host 'Publishing uses your existing docker login. If needed, run docker login before this build.' }
$versionDescription = if ($selection.Version) { $selection.Version } elseif ($selection.KeepVersion) { $current } else { "next unused, starting at $current" }
Write-Host "`nVersion: $versionDescription | Upload: $($selection.Publish) | Image TAR: $($selection.ExportImage) | Offline ZIP: $($selection.Offline)"
if ($selection.Publish -and $selection.KeepVersion) { Write-Host 'An existing published tag will be rejected; it will not be overwritten.' }
if ((Read-BuildChoice 'Start build? (sample: y; Enter=y)' @('y','n') 'y') -eq 'n') { return }
if ($PlanOnly) { return $selection }
& "$PSScriptRoot/build-release.ps1" @selection
