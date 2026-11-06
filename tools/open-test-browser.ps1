param([switch]$WithBaseline)
$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$outputDir = Join-Path $projectRoot 'output\playwright'
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
$browserRoot = Join-Path $env:LOCALAPPDATA 'ms-playwright'
$executables = @(Get-ChildItem -LiteralPath $browserRoot -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^chromium-\d+$' } | Sort-Object LastWriteTime -Descending | ForEach-Object { Join-Path $_.FullName 'chrome-win64\chrome.exe' } | Where-Object { Test-Path -LiteralPath $_ })
if ($executables.Count -eq 0) {
    throw 'Install a test browser first: npx --yes --package playwright playwright install chromium'
}
$extensionPaths = $projectRoot
if ($WithBaseline) {
    $baselineDir = Join-Path $projectRoot 'output\baseline-v12'
    Expand-Archive -LiteralPath (Join-Path $projectRoot 'tests\baseline\bili-focus-1.2.0.zip') -DestinationPath $baselineDir -Force
    $extensionPaths = "$projectRoot,$baselineDir"
}
$profilePath = Join-Path $outputDir ('profile-check-' + [guid]::NewGuid().ToString('N'))
$config = @{browser=@{browserName='chromium';userDataDir=$profilePath;launchOptions=@{headless=$true;channel='chromium';executablePath=$executables[0];ignoreDefaultArgs=@('--disable-extensions');args=@("--disable-extensions-except=$extensionPaths","--load-extension=$extensionPaths")};contextOptions=@{viewport=@{width=400;height=520};colorScheme='light'}};outputDir=$outputDir}
$configPath = Join-Path $outputDir 'test-browser.config.json'
[System.IO.File]::WriteAllText($configPath,($config | ConvertTo-Json -Depth 8),[System.Text.UTF8Encoding]::new($false))
Push-Location -LiteralPath $projectRoot
try {
    npx --yes --package @playwright/cli playwright-cli -s=bili-focus-check open --config $configPath
} finally { Pop-Location }
