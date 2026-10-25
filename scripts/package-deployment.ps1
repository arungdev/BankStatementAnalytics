param([string]$Destination, [string]$ImageArchive)
& "$PSScriptRoot/../deploy/common/package-deployment.ps1" -ProjectRoot (Split-Path $PSScriptRoot -Parent) @PSBoundParameters
