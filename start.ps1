# POD one-click launcher: resolve Node, restart local server, open browser.
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Url = "http://127.0.0.1:8787/"
$ServerEntry = [IO.Path]::GetFullPath((Join-Path $Root "server\index.js"))
$PortableNodeDir = Join-Path $Root "tools\node"
$PortableNodeExe = Join-Path $PortableNodeDir "node.exe"
$NodeVersion = "20.18.1"
$NodeZipName = "node-v$NodeVersion-win-x64.zip"
$NodeFolderName = "node-v$NodeVersion-win-x64"
$MirrorUrl = "https://npmmirror.com/mirrors/node/v$NodeVersion/$NodeZipName"
$OfficialUrl = "https://nodejs.org/dist/v$NodeVersion/$NodeZipName"

function Write-Step([string]$Message, [string]$Color = "Cyan") {
  Write-Host $Message -ForegroundColor $Color
}

function Write-Fail([string]$Message) {
  Write-Host $Message -ForegroundColor Red
}

function Test-NodeExe([string]$ExePath) {
  if (-not $ExePath -or -not (Test-Path -LiteralPath $ExePath)) { return $false }
  try {
    $output = & $ExePath -v 2>$null
    return ($LASTEXITCODE -eq 0 -and "$output" -match "^v\d+")
  } catch {
    return $false
  }
}

function Get-SystemNodePath {
  try {
    $cmd = Get-Command node -ErrorAction Stop
    if (Test-NodeExe $cmd.Source) { return $cmd.Source }
  } catch {}
  return $null
}

function Install-PortableNode {
  Write-Step "Node.js not found. Downloading portable Node v$NodeVersion ..."
  Write-Host "  target: $PortableNodeDir"
  New-Item -ItemType Directory -Force -Path $PortableNodeDir | Out-Null

  $zipPath = Join-Path $env:TEMP "pod-$NodeZipName"
  $extractRoot = Join-Path $env:TEMP "pod-node-extract-$NodeVersion"
  if (Test-Path -LiteralPath $extractRoot) {
    Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
  New-Item -ItemType Directory -Force -Path $extractRoot | Out-Null

  $downloaded = $false
  foreach ($pair in @(
    @{ Name = "npmmirror"; Url = $MirrorUrl },
    @{ Name = "nodejs.org"; Url = $OfficialUrl }
  )) {
    try {
      Write-Step "  trying $($pair.Name) ..."
      if (Test-Path -LiteralPath $zipPath) {
        Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
      }
      # TLS 1.2 for older Windows PowerShell.
      try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
      } catch {}
      Invoke-WebRequest -Uri $pair.Url -OutFile $zipPath -UseBasicParsing -TimeoutSec 180
      if ((Get-Item -LiteralPath $zipPath).Length -lt 1MB) {
        throw "download too small"
      }
      $downloaded = $true
      Write-Step "  downloaded from $($pair.Name)" "Green"
      break
    } catch {
      Write-Host "  $($pair.Name) failed: $($_.Exception.Message)" -ForegroundColor Yellow
    }
  }

  if (-not $downloaded) {
    Write-Fail "Failed to download Node.js (offline or blocked network)."
    Write-Fail "Copy a portable Node folder to:"
    Write-Fail "  $PortableNodeDir"
    Write-Fail "so that this file exists:"
    Write-Fail "  $PortableNodeExe"
    Write-Fail "Or install Node 18+ and ensure 'node' is on PATH."
    exit 1
  }

  try {
    Write-Step "Extracting Node ..."
    Expand-Archive -LiteralPath $zipPath -DestinationPath $extractRoot -Force
    $extracted = Join-Path $extractRoot $NodeFolderName
    if (-not (Test-Path -LiteralPath (Join-Path $extracted "node.exe"))) {
      $found = Get-ChildItem -Path $extractRoot -Filter "node.exe" -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1
      if ($found) {
        $extracted = $found.DirectoryName
      } else {
        throw "node.exe missing inside zip"
      }
    }

    # Replace portable dir with extracted runtime files.
    Get-ChildItem -LiteralPath $PortableNodeDir -Force -ErrorAction SilentlyContinue |
      Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    Copy-Item -Path (Join-Path $extracted "*") -Destination $PortableNodeDir -Recurse -Force

    if (-not (Test-NodeExe $PortableNodeExe)) {
      throw "portable node.exe is not runnable"
    }
    Write-Step "Portable Node ready: $PortableNodeExe" "Green"
  } finally {
    Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Resolve-NodePath {
  $systemNode = Get-SystemNodePath
  if ($systemNode) {
    Write-Step "Using system Node: $systemNode" "Green"
    return $systemNode
  }
  if (Test-NodeExe $PortableNodeExe) {
    Write-Step "Using portable Node: $PortableNodeExe" "Green"
    return $PortableNodeExe
  }
  Install-PortableNode
  if (-not (Test-NodeExe $PortableNodeExe)) {
    Write-Fail "Portable Node install finished but node.exe is still missing."
    exit 1
  }
  Write-Step "Using portable Node: $PortableNodeExe" "Green"
  return $PortableNodeExe
}

function Stop-ExistingPodServer {
  Write-Step "Checking port 8787 ..."
  $serverPid = 0
  $lines = netstat -ano -p tcp
  foreach ($line in $lines) {
    if ($line -match '^\s*TCP\s+127\.0\.0\.1:8787\s+\S+\s+LISTENING\s+(\d+)\s*$') {
      $serverPid = [int]$Matches[1]
      break
    }
  }
  if (-not $serverPid) {
    Write-Host "  port free"
    return
  }

  $serverProcess = Get-Process -Id $serverPid -ErrorAction Stop
  $serverDetails = Get-CimInstance Win32_Process -Filter ("ProcessId = " + $serverPid) -ErrorAction Stop
  $commandLine = [string]$serverDetails.CommandLine
  $isCurrentPod = $serverProcess.ProcessName -eq "node" -and
    $commandLine.IndexOf($ServerEntry, [StringComparison]::OrdinalIgnoreCase) -ge 0
  if (-not $isCurrentPod) {
    Write-Fail "Port 8787 is used by another program. It was not stopped."
    Write-Host $commandLine
    exit 1
  }
  try {
    Write-Step "Stopping previous POD server (PID $serverPid) ..."
    Stop-Process -Id $serverPid -Force -ErrorAction Stop
    $null = $serverProcess.WaitForExit(5000)
  } catch {
    Write-Fail "Unable to stop the existing POD server. Run start.cmd as administrator once."
    exit 1
  }
}

function Start-PodServer([string]$NodeExe) {
  Write-Step "Starting POD server ..."
  if (-not (Test-Path -LiteralPath $ServerEntry)) {
    Write-Fail "Missing server entry: $ServerEntry"
    exit 1
  }
  Start-Process -FilePath $NodeExe -ArgumentList @($ServerEntry) -WorkingDirectory $Root -WindowStyle Hidden
  $healthy = $false
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    try {
      $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 ($Url + "api/health")
      if ($response.StatusCode -eq 200) {
        $healthy = $true
        break
      }
    } catch {}
    Write-Host "  waiting health check ($($i + 1)/40) ..."
  }
  if (-not $healthy) {
    Write-Fail "POD server failed to start on 127.0.0.1:8787."
    exit 1
  }
  Write-Step "Server healthy. Opening $Url" "Green"
  Start-Process $Url
}

Write-Host ""
Write-Host "=== POD Image Workflow ===" -ForegroundColor White
Write-Host "Root: $Root"
$nodeExe = Resolve-NodePath
Stop-ExistingPodServer
Start-PodServer $nodeExe
Write-Step "Done. This window will close in 2 seconds." "Green"
Start-Sleep -Seconds 2
exit 0
