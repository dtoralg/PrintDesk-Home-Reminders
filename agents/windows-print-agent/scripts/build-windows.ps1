param(
  [string]$NodeExecutable = (Get-Command node -ErrorAction Stop).Source
)

$ErrorActionPreference = "Stop"
$agentRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$workspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $agentRoot "..\.."))
$distRoot = Join-Path $agentRoot "dist"
$releaseRoot = Join-Path $distRoot "windows-x64"
$bundlePath = Join-Path $distRoot "agent.cjs"
$blobPath = Join-Path $distRoot "agent.blob"
$seaConfigPath = Join-Path $distRoot "sea-config.json"
$executablePath = Join-Path $releaseRoot "printdesk-agent.exe"
$esbuild = Join-Path $workspaceRoot "node_modules\.bin\esbuild.cmd"
$postject = Join-Path $workspaceRoot "node_modules\.bin\postject.cmd"

if (-not (Test-Path -LiteralPath $esbuild)) { throw "esbuild_not_installed" }
if (-not (Test-Path -LiteralPath $postject)) { throw "postject_not_installed" }
New-Item -ItemType Directory -Force -Path $distRoot, $releaseRoot | Out-Null

& $esbuild (Join-Path $agentRoot "src\subscriber-cli.ts") `
  --bundle --platform=node --format=cjs --target=node24 "--outfile=$bundlePath"
if ($LASTEXITCODE -ne 0) { throw "agent_bundle_failed" }

@{
  main = $bundlePath
  output = $blobPath
  disableExperimentalSEAWarning = $true
  useSnapshot = $false
  useCodeCache = $false
} | ConvertTo-Json | Set-Content -LiteralPath $seaConfigPath -Encoding utf8

& $NodeExecutable "--experimental-sea-config=$seaConfigPath"
if ($LASTEXITCODE -ne 0) { throw "agent_sea_blob_failed" }
Copy-Item -LiteralPath $NodeExecutable -Destination $executablePath -Force

& $postject $executablePath NODE_SEA_BLOB $blobPath `
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
if ($LASTEXITCODE -ne 0) { throw "agent_sea_injection_failed" }

Copy-Item -LiteralPath (Join-Path $agentRoot "config.production.json") `
  -Destination (Join-Path $releaseRoot "config.json.example") -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "install-windows.ps1") -Destination $releaseRoot -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "uninstall-windows.ps1") -Destination $releaseRoot -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "status-windows.ps1") -Destination $releaseRoot -Force

$archivePath = Join-Path $distRoot "printdesk-agent-windows-x64.zip"
Compress-Archive -Path (Join-Path $releaseRoot "*") -DestinationPath $archivePath -Force
$hash = Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath
Write-Output "Executable: $executablePath"
Write-Output "Archive: $archivePath"
Write-Output "SHA256: $($hash.Hash)"
