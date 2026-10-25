param([Parameter(Mandatory=$true)][string]$ProjectRoot, [string]$Destination, [string]$ImageArchive)
$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
if (-not $Destination) { $Destination = Join-Path $ProjectRoot 'Setup/SSH-Deployment.zip' }
$Destination = [IO.Path]::GetFullPath($Destination)
if ([IO.Path]::GetExtension($Destination) -ne '.zip') { throw 'Destination must be a ZIP file.' }
# Explicit runtime allowlist: never recursively archive a development directory.
$files = @(
    'Setup.bat', 'Update.bat', 'deploy-ssh.bat', 'enable-https.bat', 'setup-google-login.bat', 'docker-compose.yml',
    'deploy/common/update-existing.sh',
    'deploy/common/prepare-upgrade.sh', 'deploy/common/backup-key.ps1',
    'deploy/setup-google-ssh.ps1', 'deploy/common/setup-google-ssh.ps1', 'deploy/common/configure-google.sh',
    'deploy/deploy-ssh.ps1', 'deploy/server-deploy.sh', 'deploy/backup.sh', 'deploy/restore.sh',
    'deploy/project.env', 'deploy/Caddyfile', 'deploy/init-db.sh', 'deploy/google-compose.yml', 'deploy/README.md',
    'deploy/common/deploy-ssh.ps1', 'deploy/common/server-deploy.sh',
    'deploy/common/ssh-auth.ps1', 'deploy/common/session-deploy.sh',
    'deploy/common/project-config.sh', 'deploy/common/backup.sh', 'deploy/common/restore.sh',
    'deploy/common/Templates/Caddyfile', 'deploy/common/README.md'
)
if (Test-Path -LiteralPath (Join-Path $ProjectRoot '.env.example')) { $files += '.env.example' }
foreach ($relative in $files) {
    if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot $relative) -PathType Leaf)) {
        throw "Required deployment file is missing: $relative"
    }
}
if ($ImageArchive) {
    $ImageArchive = (Resolve-Path -LiteralPath $ImageArchive).Path
    if ([IO.Path]::GetExtension($ImageArchive) -ne '.tar') { throw 'ImageArchive must be a docker save TAR file.' }
}
$destinationParent = Split-Path $Destination -Parent
if ($destinationParent) { New-Item -ItemType Directory -Force -Path $destinationParent > $null }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$stream = [IO.File]::Open($Destination, [IO.FileMode]::Create)
$archive = $null
try {
    $archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create)
    foreach ($relative in $files) {
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,
            (Join-Path $ProjectRoot $relative), $relative, [IO.Compression.CompressionLevel]::Optimal) > $null
    }
    $setupReadme = Join-Path $ProjectRoot 'deploy/SETUP-README.md'
    if (Test-Path -LiteralPath $setupReadme) {
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $setupReadme,
            'START-HERE.md', [IO.Compression.CompressionLevel]::Optimal) > $null
    }
    if ($ImageArchive) {
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $ImageArchive,
            'application-image.tar', [IO.Compression.CompressionLevel]::Optimal) > $null
        $hashEntry = $archive.CreateEntry('application-image.tar.sha256')
        $hashWriter = [IO.StreamWriter]::new($hashEntry.Open(), [Text.UTF8Encoding]::new($false))
        try { $hashWriter.WriteLine(('{0}  application-image.tar' -f (Get-FileHash -LiteralPath $ImageArchive -Algorithm SHA256).Hash.ToLowerInvariant())) }
        finally { $hashWriter.Dispose() }
    }
} finally {
    if ($archive) { $archive.Dispose() } else { $stream.Dispose() }
}
Write-Host "Created $Destination"
