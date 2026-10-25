param([string]$Server, [int]$Port = 22, [string]$Domain, [string]$Email, [string]$Version, [int]$LocalPort = 18080, [switch]$EnableHttpsOnly, [switch]$UnifiedSetup, [switch]$UpdateExisting)
& "$PSScriptRoot/common/deploy-ssh.ps1" -ProjectRoot (Split-Path $PSScriptRoot -Parent) @PSBoundParameters
