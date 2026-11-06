$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Push-Location -LiteralPath $projectRoot
try {
    node tools/check.js
    if ($LASTEXITCODE -ne 0) { throw 'Extension check failed' }
    $manifest = Get-Content -LiteralPath 'manifest.json' -Raw -Encoding UTF8 | ConvertFrom-Json
    New-Item -ItemType Directory -Path 'dist' -Force | Out-Null
    $archivePath = Join-Path $projectRoot "dist\bili-focus-$($manifest.version).zip"
    $files = @('manifest.json', 'background.js', 'content.js', 'popup.html', 'popup.js', 'popup.css', 'popup-custom.css', 'popup-library.css', 'shared', 'icons', 'assets', 'vendor', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'PRIVACY.md', 'CHANGELOG.md', 'TEST_REPORT.md', 'docs')
    Compress-Archive -LiteralPath $files -DestinationPath $archivePath -Force
    $sourcePath = Join-Path $projectRoot "dist\bili-focus-$($manifest.version)-source.zip"
    $sourceFiles = $files + @('ui', 'tools', 'tests', 'design', 'package.json', 'package-lock.json', '.gitignore', '.gitattributes', '.github', 'CONTRIBUTING.md')
    Compress-Archive -LiteralPath $sourceFiles -DestinationPath $sourcePath -Force
    Get-Item -LiteralPath $archivePath | Select-Object FullName, Length
    Get-Item -LiteralPath $sourcePath | Select-Object FullName, Length
} finally {
    Pop-Location
}
