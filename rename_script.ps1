$files = Get-ChildItem -Path d:\BankStatementAnalytics -Include *.cs,*.cshtml,*.csproj,*.sln,*.slnx -Recurse -File
foreach ($file in $files) {
    $path = $file.FullName
    if ($path -match '\\obj\\' -or $path -match '\\bin\\' -or $path -match '\.vs\\') { continue }
    $content = [System.IO.File]::ReadAllText($path)
    $newContent = $content.Replace('temp-personal', 'BankStatementAnalytics').Replace('temp_personal', 'BankStatementAnalytics')
    if ($content -cne $newContent) {
        [System.IO.File]::WriteAllText($path, $newContent)
    }
}

$oldCsproj = 'd:\BankStatementAnalytics\BankStatementAnalytics\temp-personal.csproj'
if (Test-Path $oldCsproj) { Rename-Item -Path $oldCsproj -NewName 'BankStatementAnalytics.csproj' }

$oldCsprojUser = 'd:\BankStatementAnalytics\BankStatementAnalytics\temp-personal.csproj.user'
if (Test-Path $oldCsprojUser) { Rename-Item -Path $oldCsprojUser -NewName 'BankStatementAnalytics.csproj.user' }

$oldSlnx = 'd:\BankStatementAnalytics\temp-personal.slnx'
if (Test-Path $oldSlnx) { Rename-Item -Path $oldSlnx -NewName 'BankStatementAnalytics.slnx' }
