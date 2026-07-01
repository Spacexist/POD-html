@echo off
setlocal
set "ROOT=%~dp0"
set "URL=http://127.0.0.1:8787/"

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop'; $url='%URL%'; $root='%ROOT%';" ^
  "$healthy=$false; try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 ($url+'api/health'); $healthy=($r.StatusCode -eq 200) } catch {}" ^
  "if(-not $healthy) { Start-Process -FilePath 'node' -ArgumentList @((Join-Path $root 'server\index.js')) -WorkingDirectory $root -WindowStyle Hidden; for($i=0;$i -lt 30;$i++){ Start-Sleep -Milliseconds 500; try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 ($url+'api/health'); if($r.StatusCode -eq 200){$healthy=$true;break} } catch {} } }" ^
  "if(-not $healthy){ Write-Host 'POD server failed to start on 127.0.0.1:8787.' -ForegroundColor Red; exit 1 }; Start-Process $url"

if errorlevel 1 pause
endlocal
