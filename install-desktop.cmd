@echo off
setlocal
cd /d "%~dp0"

REM Hybrid installer: CMD header + PowerShell body below :::BEGIN_PS1 (no install-desktop.ps1).
set "POD_ROOT=%~dp0"
if "%POD_ROOT:~-1%"=="\" set "POD_ROOT=%POD_ROOT:~0,-1%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$raw = [IO.File]::ReadAllText('%~f0');" ^
  "$marker = ':::POD_PS_BODY';" ^
  "$idx = $raw.LastIndexOf($marker);" ^
  "if ($idx -lt 0) { Write-Host 'install-desktop.cmd missing POD_PS_BODY block' -ForegroundColor Red; exit 1 }" ^
  "$script = $raw.Substring($idx + $marker.Length).TrimStart([char]13, [char]10);" ^
  "& ([scriptblock]::Create($script))"
set "ERR=%ERRORLEVEL%"

if not "%ERR%"=="0" (
  echo.
  echo Failed to create desktop shortcut.
  pause
  exit /b %ERR%
)

echo.
echo Done. Desktop shortcut created: POD Workbench
echo Launcher started. Browser will open the login page.
echo If root key.json is missing, import it on the login page.
echo You can pin the shortcut to the taskbar if you want.
pause
endlocal
exit /b 0

:::POD_PS_BODY
# Create/overwrite desktop shortcut "POD Workbench" -> start.cmd, then auto-start.
$ErrorActionPreference = "Stop"

$Root = $env:POD_ROOT
if (-not $Root) { $Root = (Get-Location).Path }
$Root = [IO.Path]::GetFullPath($Root.TrimEnd('\', '/'))

$Target = [IO.Path]::GetFullPath((Join-Path $Root "start.cmd"))
$Desktop = [Environment]::GetFolderPath("Desktop")
$ShortcutName = "POD Workbench.lnk"
$LnkPath = Join-Path $Desktop $ShortcutName

if (-not (Test-Path -LiteralPath $Target)) {
  Write-Host "Missing start.cmd next to this installer." -ForegroundColor Red
  exit 1
}
if (-not $Desktop -or -not (Test-Path -LiteralPath $Desktop)) {
  Write-Host "Desktop folder not found." -ForegroundColor Red
  exit 1
}

$chromeCandidates = @(
  (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
  (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
  (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
)
$chrome = $chromeCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($LnkPath)
$shortcut.TargetPath = $Target
$shortcut.WorkingDirectory = $Root
$shortcut.WindowStyle = 1
$shortcut.Description = "Start POD Image Workflow (local server + browser)"
if ($chrome) {
  $shortcut.IconLocation = "$chrome,0"
} else {
  $shortcut.IconLocation = "shell32.dll,13"
}
$shortcut.Save()

Write-Host "Desktop shortcut created:" -ForegroundColor Green
Write-Host "  $LnkPath"
Write-Host "Starting POD after install (login page will open in browser) ..."
$StartCmd = Join-Path $Root "start.cmd"
if (Test-Path -LiteralPath $StartCmd) {
  Start-Process -FilePath $StartCmd -WorkingDirectory $Root
  Write-Host "Launcher started. Import key.json on the login page if needed."
} else {
  Write-Host "start.cmd not found next to installer; open start.cmd manually." -ForegroundColor Yellow
}
Write-Host "Re-run this installer after moving the project folder."
exit 0
