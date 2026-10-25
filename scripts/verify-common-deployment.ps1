$ErrorActionPreference = 'Stop'
$module = (Resolve-Path -LiteralPath (Join-Path (Split-Path $PSScriptRoot -Parent) 'deploy/common')).Path
$manifest = Get-Content -Raw -LiteralPath (Join-Path $module 'manifest.json') | ConvertFrom-Json
$actualFiles = @(Get-ChildItem -LiteralPath $module -File -Recurse | Where-Object Name -ne 'manifest.json' | ForEach-Object { $_.FullName.Substring($module.Length + 1).Replace('\', '/') })
if (@(Compare-Object @($manifest.artifacts.path | Sort-Object -Unique) @($actualFiles | Sort-Object -Unique)).Count) {
    throw 'Shared deployment module contains missing or untracked files. Refresh it from Common.Framework.'
}
foreach ($artifact in $manifest.artifacts) {
    if ($artifact.path -match '(^|[\\/])\.\.([\\/]|$)' -or [IO.Path]::IsPathRooted($artifact.path)) { throw 'Unsafe manifest path.' }
    $actual = (Get-FileHash -LiteralPath (Join-Path $module $artifact.path) -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $artifact.sha256) { throw "Generated deployment module changed: $($artifact.path). Refresh it from Common.Framework." }
}
Write-Host "Verified $($manifest.artifacts.Count) shared deployment artifacts."
