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
echo Launcher started. Browser will open the login page.
echo If root key.json is missing, import it on the login page.
echo You can pin the shortcut to the taskbar if you want.
pause
endlocal
exit /b 0
