$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$destination = Join-Path $projectRoot '.build/package-regression/deployment.zip'
& (Join-Path $projectRoot 'scripts/package-deployment.ps1') -Destination $destination
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($destination)
try {
    $entries = @($archive.Entries.FullName)
    foreach ($required in @('deploy-ssh.bat', 'enable-https.bat', 'docker-compose.yml', 'deploy/project.env',
        'deploy/server-deploy.sh', 'deploy/common/server-deploy.sh',
        'deploy/common/project-config.sh', 'deploy/common/Templates/Caddyfile',
        'deploy/common/ssh-auth.ps1', 'deploy/common/session-deploy.sh',
        'deploy/common/backup.sh', 'deploy/common/restore.sh')) {
        if ($entries -notcontains $required) { throw "Missing runtime file: $required" }
    }
    $forbidden = '\.cs$|(^|/)Source/|(^|/)manifest\.json$|smoke-test|publish-image|package-deployment|(^|/)\.env$|(^|/)secrets/|(^|/)backups/'
    if ($entries | Where-Object { $_ -match $forbidden }) { throw 'End-user ZIP contains development files or private data.' }
    Write-Host "PASS: end-user ZIP has the required runtime files and excludes C# source, build tools and private data ($($entries.Count) files)."
} finally { $archive.Dispose() }
$syntheticImage = Join-Path (Split-Path $destination -Parent) 'synthetic-image.tar'
[IO.File]::WriteAllText($syntheticImage, 'Synthetic archive for packaging tests only')
$offlineDestination = Join-Path (Split-Path $destination -Parent) 'offline-deployment.zip'
& (Join-Path $projectRoot 'scripts/package-deployment.ps1') -Destination $offlineDestination -ImageArchive $syntheticImage
$archive = [IO.Compression.ZipFile]::OpenRead($offlineDestination)
try {
    if (@($archive.Entries.FullName) -notcontains 'application-image.tar') { throw 'Offline image archive missing.' }
    if ($archive.Entries.FullName | Where-Object { $_ -match $forbidden }) { throw 'Offline package contains development files.' }
    Write-Host 'PASS: optional offline image is included without adding source or private files.'
} finally { $archive.Dispose() }
