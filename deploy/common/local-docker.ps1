param([Parameter(Mandatory=$true)][string]$ProjectRoot, [switch]$Reconfigure, [switch]$NoBuild, [switch]$Stop)
$ErrorActionPreference = 'Stop'
function Invoke-LocalCommand([string]$Command, [string[]]$Arguments) {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command failed (exit $LASTEXITCODE)." }
}
function New-LocalPassword {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return ([BitConverter]::ToString($bytes)).Replace('-','').ToLowerInvariant()
}
try {
    $ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
    $state = Join-Path $ProjectRoot '.local-docker'
    $envPath = Join-Path $state 'local.env'
    $composePath = Join-Path $state 'compose.yml'
    foreach ($tool in @('docker','dotnet')) {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "Install $tool first (Docker Desktop with Linux containers and the .NET SDK)." }
    }
    $config = @{}
    foreach ($line in Get-Content (Join-Path $ProjectRoot 'deploy/project.env')) {
        if ($line -match '^([A-Z_]+)=([A-Za-z0-9_./,:+-]*)$') { $config[$Matches[1]] = $Matches[2] }
    }
    $service = $config.APP_SERVICE
    if ($service -notmatch '^[a-zA-Z0-9][a-zA-Z0-9_-]*$') { throw 'Invalid APP_SERVICE.' }
    $image = "$($config.DEPLOY_DIRECTORY):local-google"
    $projectName = "$($config.DEPLOY_DIRECTORY)-local-google"
    $compose = @('compose','--project-name',$projectName,'--project-directory',$ProjectRoot,'--env-file',$envPath,
        '-f',(Join-Path $ProjectRoot 'docker-compose.yml'),'-f',(Join-Path $ProjectRoot 'deploy/google-compose.yml'),'-f',$composePath)
    if ($Stop) {
        if (-not (Test-Path $composePath)) { throw 'Local Docker has not been configured yet.' }
        Invoke-LocalCommand docker ($compose + @('stop'))
        Write-Host 'Local containers stopped. Database and workspace volumes were kept.'
        return
    }
    Invoke-LocalCommand docker @('info','--format','{{.OSType}}')
    New-Item -ItemType Directory -Force -Path $state > $null
    # Limit local credentials and the development certificate to this Windows user.
    if ($env:OS -eq 'Windows_NT') {
        $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        Invoke-LocalCommand icacls @($state,'/inheritance:r','/grant:r',"*${sid}:(OI)(CI)F")
    }
    $utf8 = [Text.UTF8Encoding]::new($false)
    $values = @{}
    if (Test-Path $envPath) {
        foreach ($line in Get-Content $envPath) { if ($line -match '^([A-Z_]+)=(.*)$') { $values[$Matches[1]] = $Matches[2] } }
    }
    Write-Host 'Google Console: use an OAuth Web application client.'
    Write-Host 'Add authorized redirect URI: https://localhost:8443/signin-google'
    Write-Host 'Keep your cloud redirect URI if using the same client. A separate development client is preferable.'
    if ($Reconfigure -or -not $values.GOOGLE_CLIENT_ID -or -not (Test-Path (Join-Path $state 'google_client_secret.txt'))) {
        $id = Read-Host 'Google Client ID (sample: your-client-id.apps.googleusercontent.com)'
        if ($id -notmatch '^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$') { throw 'Invalid Google Client ID.' }
        $secret = Read-Host 'Google Client Secret (sample format: paste-your-client-secret; visible)'
        if ($secret -notmatch '^[A-Za-z0-9_-]{1,512}$') { throw 'Invalid Google Client Secret.' }
        [IO.File]::WriteAllText((Join-Path $state 'google_client_secret.txt'),$secret,$utf8)
        $secret = $null
        $values.GOOGLE_CLIENT_ID = $id
    }
    foreach ($name in @('db_password','db_operator_password')) {
        $path = Join-Path $state "$name.txt"
        if (-not (Test-Path $path)) { [IO.File]::WriteAllText($path,(New-LocalPassword),$utf8) }
    }
    if (-not $values.LOCAL_CERT_PASSWORD) { $values.LOCAL_CERT_PASSWORD = New-LocalPassword }
    $values.APP_IMAGE = $config.DEPLOY_DIRECTORY
    $values.APP_VERSION = 'local-google'
    $values.APP_DOMAIN = 'localhost'
    $envLines = foreach ($key in ($values.Keys | Sort-Object)) { "$key=$($values[$key])" }
    [IO.File]::WriteAllText($envPath,($envLines -join "`n") + "`n",$utf8)
    Write-Host 'Preparing trusted localhost HTTPS. Windows may ask you to trust the development certificate.'
    Invoke-LocalCommand dotnet @('dev-certs','https','--trust','--export-path',(Join-Path $state 'devcert.pfx'),'--password',$values.LOCAL_CERT_PASSWORD)
    $override = @'
services:
  APP_SERVICE:
    pull_policy: never
    ports: !override
      - "127.0.0.1:8443:8443"
    environment:
      Kestrel__Endpoints__Http__Url: http://+:8080
      Kestrel__Endpoints__Https__Url: https://+:8443
      Kestrel__Endpoints__Https__Certificate__Path: /run/secrets/local_devcert
      Kestrel__Endpoints__Https__Certificate__Password: ${LOCAL_CERT_PASSWORD:?Missing local certificate password}
    secrets:
      - local_devcert
secrets:
  db_password:
    file: ./.local-docker/db_password.txt
  db_operator_password:
    file: ./.local-docker/db_operator_password.txt
  google_client_secret:
    file: ./.local-docker/google_client_secret.txt
  local_devcert:
    file: ./.local-docker/devcert.pfx
networks:
  proxy:
    ipam:
      config: !override
        - subnet: 172.30.59.0/24
'@
    [IO.File]::WriteAllText($composePath,$override.Replace('APP_SERVICE',$service).Replace("`r`n","`n") + "`n",$utf8)
    Invoke-LocalCommand docker ($compose + @('config','--quiet'))
    Push-Location -LiteralPath $ProjectRoot
    try {
        if (-not $NoBuild) { Invoke-LocalCommand docker @('build','--platform','linux/amd64','-t',$image,'.') }
        Invoke-LocalCommand docker @('image','inspect',$image,'--format','{{.Id}}')
        Invoke-LocalCommand docker ($compose + @('up','-d','--no-build','--wait','--wait-timeout','180'))
        # Refresh certificate/secret mounts even when only a local file changed.
        Invoke-LocalCommand docker ($compose + @('up','-d','--no-deps','--force-recreate','--no-build','--wait','--wait-timeout','180',$service))
    } finally { Pop-Location }
    Write-Host 'Local Docker ready: https://localhost:8443'
    Write-Host 'Google settings are saved locally. Run Local-Docker.bat again after editing code to rebuild; no Docker Hub upload.'
    Start-Process 'https://localhost:8443'
} catch { Write-Error $_; exit 1 }
