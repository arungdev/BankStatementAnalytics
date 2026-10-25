param([switch]$DisposableTest)
$ErrorActionPreference = 'Stop'
if (!$DisposableTest) { throw 'Use -DisposableTest only with a disposable synthetic stack on localhost:18089.' }
Import-Module Microsoft.PowerShell.Utility
$base = 'http://127.0.0.1:18089'
$checks = 0
function Check($value, $name) { if (!$value) { throw $name }; $script:checks++; Write-Output "PASS: $name" }
function Call($path, $session, $body, $method = 'GET', $origin = $base) {
    $args = @{ Uri = "$base$path"; Method = $method; SkipHttpErrorCheck = $true; Headers = @{ Origin = $origin } }
    if ($session) { $args.WebSession = $session }
    if ($null -ne $body) { $args.ContentType = 'application/json'; $args.Body = ($body | ConvertTo-Json -Depth 8) }
    Invoke-WebRequest @args
}
$admin = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
$authAction = if ((Call '/api/auth/status' $null $null).Content -match '"needsSetup":true') { 'setup' } else { 'login' }
$r = Call "/api/auth/$authAction" $admin @{ username='synthetic-admin'; password='Synthetic-admin-only-42!' } 'POST'
Check ($r.StatusCode -eq 200) "private HTTP administrator setup ($($r.StatusCode))"
$r = Call '/api/auth/users' $admin @{ username='synthetic-alice'; password='Synthetic-alice-only-42!'; role='User' } 'POST'
Check ($r.StatusCode -in 200,409) "administrator creates Alice ($($r.StatusCode))"
$r = Call '/api/auth/users' $admin @{ username='synthetic-bob'; password='Synthetic-bob-only-42!'; role='User' } 'POST'
Check ($r.StatusCode -in 200,409) "administrator creates Bob ($($r.StatusCode))"
$alice = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
$bob = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
Check ((Call '/api/auth/login' $alice @{username='synthetic-alice';password='Synthetic-alice-only-42!'} 'POST').StatusCode -eq 200) 'Alice login'
Check ((Call '/api/auth/login' $bob @{username='synthetic-bob';password='Synthetic-bob-only-42!'} 'POST').StatusCode -eq 200) 'Bob login'
$r = Call '/api/accounts' $alice @{accountHolderName='Alice';accountNumber='1234567890';bankName='HDFC';ownerUserId=999;id=999} 'POST'
Check ($r.StatusCode -eq 201) "Alice creates an account with server-assigned identity ($($r.StatusCode))"
$account = $r.Content | ConvertFrom-Json
$account | ConvertTo-Json -Compress | Write-Output
$r = Call '/api/accounts' $bob $null
Check ($r.StatusCode -eq 200 -and $r.Content -notmatch 'Alice') 'Bob cannot list Alice account'
$r = Call '/api/statements/uploads' $bob $null
Check ($r.StatusCode -eq 200) 'Bob upload history request succeeds independently'
Check ((Call '/api/accounts' $alice @{accountHolderName='Denied';accountNumber='1234';bankName='HDFC'} 'POST' 'https://attacker.invalid').StatusCode -eq 403) 'cross-origin account creation rejected'
Check ((Call '/api/auth/register' $null @{username='unexpected';password='Synthetic-unexpected-42!'} 'POST').StatusCode -eq 403) 'public registration disabled'
Check ((Call '/api/backup/status' $admin $null).StatusCode -eq 403) 'public browser backup disabled'
Check ((Call '/api/auth/logout' $alice @{} 'POST').StatusCode -eq 200) 'Alice logout'
Check ((Call '/api/accounts' $alice $null).StatusCode -eq 401) 'Alice logout revokes access'
Check ((Call '/api/accounts' $bob $null).StatusCode -eq 200) 'Alice logout does not log Bob out'
Write-Output "Passed $checks Linux HTTP checks"
