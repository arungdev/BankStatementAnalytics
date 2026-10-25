function Find-AvailableReleaseVersion {
    param([string]$StartingVersion, [scriptblock]$TagExists)
    if ($StartingVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'Expected a three-part release version.' }
    $candidate = $StartingVersion
    for ($attempt = 0; $attempt -lt 1000; $attempt++) {
        if (-not (& $TagExists $candidate)) { return $candidate }
        $parts = [version]$candidate
        $candidate = '{0}.{1}.{2}' -f $parts.Major,$parts.Minor,($parts.Build + 1)
    }
    throw 'No available patch version found. Choose a new minor version.'
}

function Set-ReleaseFileVersions {
    param([string]$ProjectFile, [string]$DeployConfig, [string]$Version, [string]$ClientDirectory)
    if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid release version.' }
    $utf8 = [Text.UTF8Encoding]::new($false)
    $projectText = [IO.File]::ReadAllText($ProjectFile)
    $projectText = [regex]::Replace($projectText, '<Version>\d+\.\d+\.\d+</Version>', "<Version>$Version</Version>")
    [IO.File]::WriteAllText($ProjectFile,$projectText,$utf8)
    $deployText = [IO.File]::ReadAllText($DeployConfig)
    $deployText = [regex]::Replace($deployText,'(?m)^DEPLOY_VERSION=[^\r\n]+',"DEPLOY_VERSION=$Version")
    [IO.File]::WriteAllText($DeployConfig,$deployText,$utf8)
    if ($ClientDirectory) {
        foreach ($name in @('package.json','package-lock.json')) {
            $path = Join-Path $ClientDirectory $name
            if (-not (Test-Path -LiteralPath $path)) { continue }
            $content = [IO.File]::ReadAllText($path)
            $rootVersion = [regex]'(?m)^(  "version"\s*:\s*")[^"]+("[ ,]*)'
            $content = $rootVersion.Replace($content, { param($match) $match.Groups[1].Value + $Version + $match.Groups[2].Value }, 1)
            if ($name -eq 'package-lock.json') {
                $packageVersion = [regex]'(?s)("packages"\s*:\s*\{\s*""\s*:\s*\{.*?"version"\s*:\s*")[^"]+(")'
                $content = $packageVersion.Replace($content, { param($match) $match.Groups[1].Value + $Version + $match.Groups[2].Value }, 1)
            }
            [IO.File]::WriteAllText($path,$content,$utf8)
        }
    }
}
