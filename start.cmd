@echo off
setlocal
cd /d "%~dp0"

REM Hybrid launcher: CMD header + PowerShell body below :::BEGIN_PS1 (no start.ps1 file).
set "POD_ROOT=%~dp0"
if "%POD_ROOT:~-1%"=="\" set "POD_ROOT=%POD_ROOT:~0,-1%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$raw = [IO.File]::ReadAllText('%~f0');" ^
  "$marker = ':::POD_PS_BODY';" ^
  "$idx = $raw.LastIndexOf($marker);" ^
  "if ($idx -lt 0) { Write-Host 'start.cmd missing POD_PS_BODY block' -ForegroundColor Red; exit 1 }" ^
  "$script = $raw.Substring($idx + $marker.Length).TrimStart([char]13, [char]10);" ^
  "& ([scriptblock]::Create($script))"
set "ERR=%ERRORLEVEL%"

if not "%ERR%"=="0" (
  echo.
  echo POD start failed. See messages above.
  pause
  exit /b %ERR%
)

endlocal
exit /b 0

:::POD_PS_BODY
# POD one-click launcher: resolve Node, free port 8787, start server, open browser.
$ErrorActionPreference = "Stop"

# Hybrid .cmd sets POD_ROOT to the project folder; fall back to cwd.
$Root = $env:POD_ROOT
if (-not $Root) { $Root = (Get-Location).Path }
$Root = [IO.Path]::GetFullPath($Root.TrimEnd('\', '/'))

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

function Get-Port8787ListenerPids {
  $pids = @{}
  $lines = netstat -ano -p tcp
  foreach ($line in $lines) {
    if ($line -match '^\s*TCP\s+\S*:8787\s+\S+\s+LISTENING\s+(\d+)\s*$') {
      $pidValue = [int]$Matches[1]
      if ($pidValue -gt 0) {
        $pids[$pidValue] = $true
      }
    }
  }
  return @($pids.Keys)
}

function Stop-ExistingPodServer {
  Write-Step "Freeing port 8787 (kill any listener, then start) ..."
  $listenerPids = Get-Port8787ListenerPids
  if (-not $listenerPids -or $listenerPids.Count -eq 0) {
    Write-Host "  port free"
    return
  }

  foreach ($serverPid in $listenerPids) {
    $procName = "?"
    $commandLine = ""
    try {
      $serverProcess = Get-Process -Id $serverPid -ErrorAction SilentlyContinue
      if ($serverProcess) { $procName = $serverProcess.ProcessName }
      $serverDetails = Get-CimInstance Win32_Process -Filter ("ProcessId = " + $serverPid) -ErrorAction SilentlyContinue
      if ($serverDetails) { $commandLine = [string]$serverDetails.CommandLine }
    } catch {}

    Write-Step "  killing PID $serverPid ($procName) on port 8787 ..."
    if ($commandLine) {
      Write-Host "    $commandLine"
    }
    try {
      Stop-Process -Id $serverPid -Force -ErrorAction Stop
    } catch {
      try {
        $null = & taskkill.exe /F /PID $serverPid 2>&1
      } catch {
        Write-Fail "Unable to kill PID $serverPid. Run start.cmd as administrator once."
        Write-Host $_.Exception.Message
        exit 1
      }
    }
  }

  $cleared = $false
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 250
    $remaining = Get-Port8787ListenerPids
    if (-not $remaining -or $remaining.Count -eq 0) {
      $cleared = $true
      break
    }
    foreach ($serverPid in $remaining) {
      try { Stop-Process -Id $serverPid -Force -ErrorAction SilentlyContinue } catch {}
      try { $null = & taskkill.exe /F /PID $serverPid 2>&1 } catch {}
    }
  }

  if (-not $cleared) {
    $still = Get-Port8787ListenerPids
    Write-Fail "Port 8787 is still occupied after kill: PID(s) $($still -join ', ')"
    Write-Fail "Run start.cmd as administrator, or manually: netstat -ano | findstr :8787"
    exit 1
  }
  Write-Step "Port 8787 is free." "Green"
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
