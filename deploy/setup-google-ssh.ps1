param([string]$Server, [int]$Port = 22)
& "$PSScriptRoot/common/setup-google-ssh.ps1" -ProjectRoot (Split-Path $PSScriptRoot -Parent) @PSBoundParameters
