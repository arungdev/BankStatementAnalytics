param([string]$Server, [int]$Port = 22, [string]$Domain, [string]$Email, [string]$Version)
& "$PSScriptRoot/common/deploy-ssh.ps1" -ProjectRoot (Split-Path $PSScriptRoot -Parent) @PSBoundParameters
