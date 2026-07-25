@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-desktop.ps1"
set "ERR=%ERRORLEVEL%"

if not "%ERR%"=="0" (
  echo.
  echo Failed to create desktop shortcut.
  pause
  exit /b %ERR%
)

echo.
echo Done. Desktop shortcut created: POD Workbench
echo You can pin it to the taskbar if you want.
pause
endlocal
exit /b 0
