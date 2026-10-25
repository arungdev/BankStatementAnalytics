$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
. "$projectRoot/deploy/common/release-version.ps1"
$selected = Find-AvailableReleaseVersion -StartingVersion '4.0.2' -TagExists { param($candidate) $candidate -in @('4.0.2','4.0.3') }
if ($selected -ne '4.0.4') { throw 'Did not select the next unused patch.' }
if ((Find-AvailableReleaseVersion '5.0.0' { $false }) -ne '5.0.0') { throw 'Unused manually selected versions must be preserved.' }
try { Find-AvailableReleaseVersion '4.0.2' { throw 'synthetic network failure' }; throw 'Network error accepted' }
catch { if ($_.Exception.Message -ne 'synthetic network failure') { throw } }
$fixture = Join-Path $projectRoot ('.build/version-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture > $null
$projectFile = Join-Path $fixture 'test.csproj'
$deployFile = Join-Path $fixture 'project.env'
'<Project><PropertyGroup><Version>4.0.2</Version></PropertyGroup></Project>' | Set-Content $projectFile
'DEPLOY_VERSION=4.0.2' | Set-Content $deployFile
@'
{
  "name": "synthetic",
  "version": "4.0.2",
  "dependencies": { "example": "1.2.3" }
}
'@ | Set-Content (Join-Path $fixture 'package.json')
@'
{
  "version": "4.0.2",
  "packages": {
    "": { "name": "synthetic", "version": "4.0.2" },
    "node_modules/example": { "version": "9.8.7" }
  }
}
'@ | Set-Content (Join-Path $fixture 'package-lock.json')
Set-ReleaseFileVersions -ProjectFile $projectFile -DeployConfig $deployFile -Version $selected -ClientDirectory $fixture
$package = Get-Content -Raw (Join-Path $fixture 'package.json') | ConvertFrom-Json
Add-Type -AssemblyName System.Web.Extensions
$lock = [Web.Script.Serialization.JavaScriptSerializer]::new().DeserializeObject([IO.File]::ReadAllText((Join-Path $fixture 'package-lock.json')))
if ($package.version -ne $selected -or $lock['version'] -ne $selected -or $lock['packages']['']['version'] -ne $selected) { throw 'Package versions differ.' }
if ($package.dependencies.example -ne '1.2.3' -or $lock['packages']['node_modules/example']['version'] -ne '9.8.7') { throw 'Dependency versions were changed.' }
if (([xml](Get-Content -Raw $projectFile)).Project.PropertyGroup.Version -ne $selected -or (Get-Content -Raw $deployFile) -notmatch 'DEPLOY_VERSION=4.0.4') { throw 'Project/deployment version synchronization failed.' }
Write-Host 'PASS: automatic unused patch selection preserves manual major/minor choices and fails closed on network errors.'
Write-Host 'PASS: project, deployment, client and lockfile root versions synchronize without modifying dependency versions.'
