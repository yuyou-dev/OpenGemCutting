param([ValidateSet('install','upgrade','doctor')][string]$Action = 'install', [switch]$AppOnly)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$compatible = $false
if ($nodeCommand) {
  & $nodeCommand.Source -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit((a===20&&b>=19)||(a===22&&b>=12)||a>22?0:1)'
  $compatible = $LASTEXITCODE -eq 0
}
if ($compatible) { $nodePath = $nodeCommand.Source } else {
  $manifest = Get-Content (Join-Path $PSScriptRoot 'runtime.json') -Raw | ConvertFrom-Json
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
  $stem = "node-v$($manifest.version)-win-$arch"
  $runtimeRoot = Join-Path $projectRoot '.runtime'
  $runtime = Join-Path $runtimeRoot $stem
  $nodePath = Join-Path $runtime 'node.exe'
  if (-not (Test-Path $nodePath)) {
    $stage = Join-Path $runtimeRoot ([guid]::NewGuid().ToString())
    New-Item -ItemType Directory -Path $stage -Force | Out-Null
    try {
      $archive = Join-Path $stage "$stem.zip"
      Invoke-WebRequest -UseBasicParsing -Uri "$($manifest.source)$stem.zip" -OutFile $archive
      if ((Get-FileHash $archive -Algorithm SHA256).Hash.ToLower() -ne $manifest."win-$arch") { throw 'Node download checksum mismatch' }
      Expand-Archive -LiteralPath $archive -DestinationPath $stage
      Move-Item -LiteralPath (Join-Path $stage $stem) -Destination $runtime
    } finally { Remove-Item -LiteralPath $stage -Recurse -Force }
  }
  $env:Path = "$runtime;$env:Path"
}
$cliArgs = @((Join-Path $PSScriptRoot 'cli.mjs'), $Action)
if ($AppOnly) { $cliArgs += '--app-only' }
& $nodePath @cliArgs
exit $LASTEXITCODE
