param([switch]$SkipPush, [switch]$Publish, [switch]$Interactive, [string]$Version, [switch]$KeepVersion, [switch]$ExportImage, [switch]$Offline)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
if ($Interactive) {
    & "$projectRoot/deploy/common/build-menu.ps1" -ProjectRoot $projectRoot -ConfigFile "$PSScriptRoot/release.config.psd1"
} else {
    & "$projectRoot/deploy/common/build-release.ps1" -ProjectRoot $projectRoot -ConfigFile "$PSScriptRoot/release.config.psd1" -SkipPush:$SkipPush -Publish:$Publish -Version $Version -KeepVersion:$KeepVersion -ExportImage:$ExportImage -Offline:$Offline
}
