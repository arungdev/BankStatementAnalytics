$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$fixture = Join-Path $projectRoot ('.build/local-docker-test-' + [Guid]::NewGuid().ToString('N'))
$state = Join-Path $fixture '.local-docker'
New-Item -ItemType Directory -Force -Path $state,(Join-Path $fixture 'deploy') > $null
Copy-Item (Join-Path $projectRoot 'docker-compose.yml') $fixture
Copy-Item (Join-Path $projectRoot 'deploy/google-compose.yml') (Join-Path $fixture 'deploy')
Copy-Item (Join-Path $projectRoot 'deploy/init-db.sh') (Join-Path $fixture 'deploy')
$script = [IO.File]::ReadAllText((Join-Path $projectRoot 'deploy/common/local-docker.ps1'))
$start = $script.IndexOf("    `$override = @'")
$start = $script.IndexOf("`n", $start) + 1
$end = $script.IndexOf("`n'@", $start)
$override = $script.Substring($start, $end - $start).Replace('APP_SERVICE','bankstatementanalytics')
[IO.File]::WriteAllText((Join-Path $state 'compose.yml'), $override)
foreach ($file in @('db_password','db_operator_password','google_client_secret')) {
    [IO.File]::WriteAllText((Join-Path $state "$file.txt"), 'synthetic-secret-only')
}
$rsa = [Security.Cryptography.RSA]::Create(2048)
$request = [Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=localhost', $rsa, [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1)
$san = [Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
$san.AddDnsName('localhost')
$request.CertificateExtensions.Add($san.Build())
$certificate = $request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-5), [DateTimeOffset]::UtcNow.AddDays(1))
[IO.File]::WriteAllBytes((Join-Path $state 'devcert.pfx'), $certificate.Export([Security.Cryptography.X509Certificates.X509ContentType]::Pfx, 'synthetic-cert-only'))
$envText = "APP_IMAGE=arungs125/bankstatementanalytics`nAPP_VERSION=4.0.0`nAPP_DOMAIN=localhost`nGOOGLE_CLIENT_ID=synthetic.apps.googleusercontent.com`nLOCAL_CERT_PASSWORD=synthetic-cert-only`n"
[IO.File]::WriteAllText((Join-Path $state 'local.env'), $envText)
$projectName = 'bsa-local-test-' + [Guid]::NewGuid().ToString('N').Substring(0,8)
$compose = @('compose','--project-name',$projectName,'--project-directory',$fixture,'--env-file',(Join-Path $state 'local.env'),'-f',(Join-Path $fixture 'docker-compose.yml'),'-f',(Join-Path $fixture 'deploy/google-compose.yml'),'-f',(Join-Path $state 'compose.yml'))
try {
    & docker @compose config --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Compose validation failed.' }
    & docker @compose up -d --no-build --wait --wait-timeout 180
    if ($LASTEXITCODE -ne 0) { throw 'Local HTTPS application startup failed.' }
    $handler = [Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    # Skip certificate validation only for this isolated loopback test client.
    # No OS trust store is changed; the real launcher trusts a development cert.
    $handler.ServerCertificateCustomValidationCallback = [Net.Http.HttpClientHandler]::DangerousAcceptAnyServerCertificateValidator
    $http = [Net.Http.HttpClient]::new($handler)
    try {
        $response = $http.GetAsync('https://localhost:8443/api/auth/options').GetAwaiter().GetResult()
        $options = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
        if (-not ($options.google -and $options.googleOnly)) { throw 'Local HTTPS did not enable Google-only mode.' }
        $startResponse = $http.GetAsync('https://localhost:8443/api/auth/google/start').GetAwaiter().GetResult()
        if ([int]$startResponse.StatusCode -ne 302 -or [Uri]::UnescapeDataString($startResponse.Headers.Location.Query) -notmatch 'redirect_uri=https://localhost:8443/signin-google') { throw 'Wrong Google callback URI.' }
        Write-Host 'PASS: isolated PostgreSQL/app healthy, localhost HTTPS enables Google-only, correct localhost Google callback.'
    } finally { $http.Dispose(); $handler.Dispose() }
} finally {
    # Only this randomly named test project and its synthetic volumes are removed.
    & docker @compose down -v
    $certificate.Dispose(); $rsa.Dispose()
}
