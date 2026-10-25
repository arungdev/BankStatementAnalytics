$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
function Test-Menu([string[]]$Answers) {
    $global:BuildMenuAnswers = [Collections.Generic.Queue[string]]::new()
    foreach ($answer in $Answers) { $global:BuildMenuAnswers.Enqueue($answer) }
    function global:Read-Host { param($Prompt); if ($global:BuildMenuAnswers.Count -eq 0) { throw "Unexpected prompt: $Prompt" }; return $global:BuildMenuAnswers.Dequeue() }
    try {
        $plan = & "$root/deploy/common/build-menu.ps1" -ProjectRoot $root -ConfigFile "$root/scripts/release.config.psd1" -PlanOnly
        if ($global:BuildMenuAnswers.Count -ne 0) { throw 'Not all test inputs were consumed.' }
        return $plan
    } finally { Remove-Item Function:\Read-Host; Remove-Variable BuildMenuAnswers -Scope Global }
}
$local = Test-Menu @('','','','','')
if ($local.Publish -or -not $local.KeepVersion -or $local.ExportImage -or $local.Offline) { throw 'Local defaults must not publish or change version.' }
$publish = Test-Menu @('2','2','y','y')
if (-not $publish.Publish -or $publish.KeepVersion -or -not $publish.Offline -or -not $publish.ExportImage) { throw 'Publish/offline selection failed.' }
$manual = Test-Menu @('invalid','1','3','invalid','4.0.0','n','y','y')
if ($manual.Version -ne '4.0.0' -or -not $manual.KeepVersion -or -not $manual.ExportImage -or $manual.Publish) { throw 'Custom version or TAR selection failed.' }
$cancel = Test-Menu @('0')
if ($cancel) { throw 'Exit must not create a build plan.' }
Write-Host 'PASS: local defaults, publish/automatic version, offline ZIP, custom version validation, image TAR and exit menu paths; no builds/uploads performed.'
