Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$cloudConfigPath = Join-Path $repoRoot "miniprogram\config\cloud.js"
$functionDirs = @(
  @{ Name = "user"; Path = (Join-Path $repoRoot "cloudfunctions\user") },
  @{ Name = "api_v2"; Path = (Join-Path $repoRoot "cloudfunctions\api_v2") }
)

function Get-StatusIcon {
  param([bool]$Ok)
  if ($Ok) { return "[OK]" }
  return "[WARN]"
}

function Read-CloudEnvId {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    return $null
  }

  $content = Get-Content $Path -Raw
  $match = [regex]::Match($content, "env:\s*'([^']+)'")
  if ($match.Success) {
    return $match.Groups[1].Value
  }

  return $null
}

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
$npmCmd = Get-Command npm -ErrorAction SilentlyContinue
$tcbCmd = Get-Command tcb -ErrorAction SilentlyContinue
$cliAlias = Get-Alias cli -ErrorAction SilentlyContinue
$envId = Read-CloudEnvId -Path $cloudConfigPath

Write-Host "Version2 cloud deploy preflight"
Write-Host ""
Write-Host ("{0} node: {1}" -f (Get-StatusIcon ([bool]$nodeCmd)), ($(if ($nodeCmd) { $nodeCmd.Source } else { "missing" })))
Write-Host ("{0} npm: {1}" -f (Get-StatusIcon ([bool]$npmCmd)), ($(if ($npmCmd) { $npmCmd.Source } else { "missing" })))
Write-Host ("{0} tcb: {1}" -f (Get-StatusIcon ([bool]$tcbCmd)), ($(if ($tcbCmd) { $tcbCmd.Source } else { "missing" })))

if ($cliAlias) {
  Write-Host ("[INFO] PowerShell alias cli -> {0}" -f $cliAlias.Definition)
}

Write-Host ("{0} cloud env id: {1}" -f (Get-StatusIcon ([bool]$envId)), ($(if ($envId) { $envId } else { "unreadable" })))
Write-Host ""

$hardFailure = $false

foreach ($item in $functionDirs) {
  $dirOk = Test-Path $item.Path
  $pkgPath = Join-Path $item.Path "package.json"
  $pkgOk = Test-Path $pkgPath

  Write-Host ("{0} function dir {1}: {2}" -f (Get-StatusIcon $dirOk), $item.Name, $item.Path)
  Write-Host ("{0} package.json {1}: {2}" -f (Get-StatusIcon $pkgOk), $item.Name, $pkgPath)

  if (-not $dirOk -or -not $pkgOk) {
    $hardFailure = $true
  }
}

if (-not $nodeCmd -or -not $npmCmd -or -not $envId) {
  $hardFailure = $true
}

Write-Host ""
Write-Host "Suggested next commands:"
Write-Host "  npm install -g @cloudbase/cli"
Write-Host "  tcb login"
if ($envId) {
  Write-Host ("  tcb env list")
  Write-Host ("  tcb env info -e {0}" -f $envId)
  foreach ($item in $functionDirs) {
    Write-Host ("  Push-Location .\cloudfunctions\{0}" -f $item.Name)
    Write-Host ("  tcb fn deploy -e {0} --force --yes" -f $envId)
    Write-Host "  Pop-Location"
  }
  Write-Host ("  tcb fn list -e {0}" -f $envId)
}

if ($hardFailure) {
  Write-Error "Preflight found blocking issues. Review the warnings above before deployment."
}
