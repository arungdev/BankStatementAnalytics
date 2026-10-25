param(
    [Parameter(Mandatory=$true)][string]$ProjectRoot,
    [Parameter(Mandatory=$true)][string]$ConfigFile,
    [switch]$SkipPush,
    [switch]$Publish,
    [string]$Version,
    [switch]$KeepVersion,
    [switch]$ExportImage,
    [switch]$Offline
)
$ErrorActionPreference = 'Stop'
if ($Publish -and $SkipPush) { throw 'Choose either -Publish or -SkipPush.' }
$SkipPush = -not $Publish
. "$PSScriptRoot/release-version.ps1"
function Invoke-ReleaseCommand {
    param([string]$Command, [string[]]$Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command failed (exit $LASTEXITCODE)." }
}
$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$config = Import-PowerShellDataFile -LiteralPath $ConfigFile
function Resolve-ReleasePath([string]$relative) {
    $resolved = [IO.Path]::GetFullPath((Join-Path $ProjectRoot $relative))
    if (-not $resolved.StartsWith($ProjectRoot.TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Release paths must stay inside the project.' }
    return $resolved
}
$project = Resolve-ReleasePath $config.ProjectFile
$versionValues = @(([xml](Get-Content -Raw -LiteralPath $project)).Project.PropertyGroup.Version | Where-Object { $_ })
if ($versionValues.Count -ne 1 -or $versionValues[0] -notmatch '^\d+\.\d+\.\d+$') { throw 'Set one semantic Version in the project file.' }
if ($Version -and $Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Version must look like 4.0.0.' }
if (-not $Version) { $Version = [string]$versionValues[0] }
$baseName = $config.BaseName
if ($baseName -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]*$') { throw 'Invalid artifact base name.' }
$repository = $config.DockerRepository
if ($repository -notmatch '^[a-z0-9][a-z0-9_-]*/[a-z0-9][a-z0-9._-]*$') { throw 'Configure a Docker Hub namespace/repository.' }
$image = "${repository}:$version"
$deployConfig = Resolve-ReleasePath 'deploy/project.env'
$settings = Get-Content -Raw -LiteralPath $deployConfig
if ($settings -notmatch '(?m)^DEPLOY_VERSION=[^\r\n]+\r?$') { throw 'Missing DEPLOY_VERSION in deploy/project.env.' }
if ($settings -notmatch "(?m)^DEPLOY_VERSION=$([regex]::Escape($version))\r?$") {
    $settings = [regex]::Replace($settings, '(?m)^DEPLOY_VERSION=[^\r\n]+', "DEPLOY_VERSION=$version")
    [IO.File]::WriteAllText($deployConfig, $settings.Replace("`r`n", "`n"), [Text.UTF8Encoding]::new($false))
    Write-Host "Synchronized deployment version to $version."
}
if ($settings -notmatch "(?m)^DEPLOY_IMAGE=$([regex]::Escape($repository))\r?$") { throw 'Deployment repository differs from release configuration.' }
foreach ($tool in @('dotnet','npm.cmd','docker')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "Install $tool before building a release." }
}
$compiler = $null
if (Get-Command ISCC.exe -ErrorAction SilentlyContinue) { $compiler = (Get-Command ISCC.exe).Source }
foreach ($candidate in @(
    (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6/ISCC.exe'),
    (Join-Path $env:ProgramFiles 'Inno Setup 6/ISCC.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs/Inno Setup 6/ISCC.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs/Inno Setup 7/ISCC.exe')
)) { if (-not $compiler -and (Test-Path -LiteralPath $candidate)) { $compiler = $candidate } }
if (-not $compiler) { throw 'Install Inno Setup, or add ISCC.exe to PATH.' }
$bundle = Resolve-ReleasePath $config.PgBundleDir
if (-not (Test-Path -LiteralPath (Join-Path $bundle 'bin/postgres.exe'))) { throw 'The local PostgreSQL bundle is required for both Windows packages.' }
Invoke-ReleaseCommand docker @('info','--format','{{.OSType}}')
if (-not $SkipPush) {
    $startingVersion = $version
    $preflightToken = (Invoke-RestMethod -UseBasicParsing -Uri "https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repository}:pull").token
    $version = Find-AvailableReleaseVersion -StartingVersion $version -TagExists {
        param($candidateVersion)
        try {
            $null = Invoke-WebRequest -UseBasicParsing -Method Head -Uri "https://registry-1.docker.io/v2/$repository/manifests/$candidateVersion" -Headers @{
                Authorization = "Bearer $preflightToken"
                Accept = 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.v2+json'
            }
            return $true
        } catch {
            if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 404) { return $false }
            throw # Network/authentication failures must not be treated as an unused tag.
        }
    }
    if ($KeepVersion -and $version -ne $startingVersion) { throw "Docker tag $startingVersion is already published. Choose an unused version or automatic version selection. Nothing was built or uploaded." }
    if ($version -ne $startingVersion) { Write-Host "Version $startingVersion is already published; automatically advancing to $version." }
}
$clientPath = if ($config.ClientDirectory) { Resolve-ReleasePath $config.ClientDirectory } else { $null }
Set-ReleaseFileVersions -ProjectFile $project -DeployConfig $deployConfig -Version $version -ClientDirectory $clientPath
$image = "${repository}:$version"
$stage = Resolve-ReleasePath ('.build/releases/' + $version + '-' + [Guid]::NewGuid().ToString('N'))
$publishDirectory = Join-Path $stage 'publish'
$artifacts = Join-Path $stage 'artifacts'
New-Item -ItemType Directory -Path $publishDirectory,$artifacts -Force > $null
Push-Location -LiteralPath $ProjectRoot
try {
    Write-Host "Building release $version. Existing Publish/data folders will not be touched."
    & (Resolve-ReleasePath 'scripts/verify-common-deployment.ps1')
    foreach ($check in $config.CheckProjects) {
        Invoke-ReleaseCommand dotnet @('run','--project',(Resolve-ReleasePath $check),'-p:ValidationBuild=true')
    }
    if ($config.ClientDirectory) {
        Push-Location -LiteralPath (Resolve-ReleasePath $config.ClientDirectory)
        try {
            Invoke-ReleaseCommand npm.cmd @('ci')
            Invoke-ReleaseCommand npm.cmd @('run','test')
        } finally { Pop-Location }
    }
    Invoke-ReleaseCommand dotnet @('publish',$project,'-c','Release','-r',$config.Runtime,'--self-contained','true','-p:PublishSingleFile=true','-p:IncludeAllContentForSelfExtract=true','-p:ValidationBuild=true','-o',$publishDirectory)
    # An isolated publish must never accidentally contain previous customer data.
    foreach ($folder in @('Data','Uploads','Logs','Sessions','secrets','backups')) {
        if (Test-Path -LiteralPath (Join-Path $publishDirectory $folder)) { throw "Refusing to package runtime data directory: $folder" }
    }
    Invoke-ReleaseCommand $compiler @("/DMyAppVersion=$version", "/DMySourceDir=$publishDirectory", "/DPgsqlBundleDir=$bundle", "/O$artifacts", (Resolve-ReleasePath $config.InstallerScript))
    & (Resolve-ReleasePath $config.PortableScript) -PublishDir $publishDirectory -OutputDir $artifacts -Version $version -PgBundleDir $bundle -BaseName $baseName -ProductName $config.ProductName
    Invoke-ReleaseCommand docker @('build','--platform','linux/amd64','-t',$image,'.')
    $cloudName = "$baseName-Cloud-$version.zip"
    & "$PSScriptRoot/package-deployment.ps1" -ProjectRoot $ProjectRoot -Destination (Join-Path $artifacts $cloudName)
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $cloudArchive = [IO.Compression.ZipFile]::Open((Join-Path $artifacts $cloudName), [IO.Compression.ZipArchiveMode]::Update)
    try {
        foreach ($document in $config.CloudDocuments) {
            $documentPath = Resolve-ReleasePath $document.Replace('{version}', $version)
            if (-not (Test-Path -LiteralPath $documentPath) -and $document.Contains('{version}')) {
                [IO.File]::WriteAllText($documentPath, "# $($config.ProductName) $version`n`nAutomatically versioned release of the current project source. See CLOUD_SECURITY.md and START-HERE.md for deployment and account policies.`n", [Text.UTF8Encoding]::new($false))
            }
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($cloudArchive, $documentPath, ('instructions/' + [IO.Path]::GetFileName($documentPath))) > $null
        }
    } finally { $cloudArchive.Dispose() }
    $names = @("$baseName-Setup-$version.exe", "$baseName-Portable-$version.zip", $cloudName)
    if ($ExportImage -or $Offline) {
        $imageName = "$baseName-$version-linux.tar"
        $imagePath = Join-Path $artifacts $imageName
        Invoke-ReleaseCommand docker @('save','--output',$imagePath,$image)
        $names += $imageName
        if ($Offline) {
            $offlineName = "$baseName-Cloud-$version-Offline.zip"
            & "$PSScriptRoot/package-deployment.ps1" -ProjectRoot $ProjectRoot -Destination (Join-Path $artifacts $offlineName) -ImageArchive $imagePath
            $names += $offlineName
        }
    }
    $digest = $null
    if (-not $SkipPush) {
        Write-Host "Publishing $image using your existing Docker login."
        Invoke-ReleaseCommand docker @('push',$image)
        # Verify that end users can pull this public image without your Docker login.
        $token = (Invoke-RestMethod -UseBasicParsing -Uri "https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repository}:pull").token
        $remote = Invoke-WebRequest -UseBasicParsing -Method Head -Uri "https://registry-1.docker.io/v2/$repository/manifests/$version" -Headers @{
            Authorization = "Bearer $token"
            Accept = 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.v2+json'
        }
        $digest = [string]$remote.Headers['Docker-Content-Digest']
        if ($remote.StatusCode -ne 200 -or -not $digest) { throw 'Anonymous Docker image verification failed. Do not distribute the cloud ZIP yet.' }
    }
    $hashes = foreach ($name in $names) {
        $file = Join-Path $artifacts $name
        if (-not (Test-Path -LiteralPath $file)) { throw "Missing release artifact: $name" }
        '{0}  {1}' -f (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant(), $name
    }
    $hashName = "$baseName-$version-SHA256SUMS.txt"
    $hashes | Set-Content -LiteralPath (Join-Path $artifacts $hashName) -Encoding ASCII
    $recordName = "$baseName-$version-release.json"
    @{
        version = $version; image = $image; published = (-not $SkipPush); digest = $digest
        createdUtc = [DateTime]::UtcNow.ToString('o'); artifacts = $names
        note = 'Build and release verification is separate from the security audit; see SECURITY_AUDIT.md.'
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $artifacts $recordName) -Encoding UTF8
    $output = Resolve-ReleasePath 'Setup'
    if ($SkipPush) { $output = Join-Path $output ('Candidates/' + $version) }
    New-Item -ItemType Directory -Path $output -Force > $null
    foreach ($name in @($names) + @($hashName,$recordName)) { Copy-Item -LiteralPath (Join-Path $artifacts $name) -Destination (Join-Path $output $name) -Force }
    Write-Host "Release artifacts: $output"
    if ($SkipPush) { Write-Warning 'Local candidate only. The online cloud ZIP requires a published image; an offline ZIP uses its bundled image.' }
    else { Write-Host "Published and anonymously verified: $image ($digest)" }
} finally { Pop-Location }
