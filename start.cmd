@echo off
setlocal
set "ROOT=%~dp0"
set "URL=http://127.0.0.1:8787/"

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop'; $url='%URL%'; $root='%ROOT%'; $serverEntry=[IO.Path]::GetFullPath((Join-Path $root 'server\index.js')); $serverPid=0;" ^
  "$lines=netstat -ano -p tcp; foreach($line in $lines){ if($line -match '^\s*TCP\s+127\.0\.0\.1:8787\s+\S+\s+LISTENING\s+(\d+)\s*$'){ $serverPid=[int]$matches[1]; break } }" ^
  "if($serverPid) { $serverProcess=Get-Process -Id $serverPid -ErrorAction Stop; $serverDetails=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$serverPid) -ErrorAction Stop; $commandLine=[string]$serverDetails.CommandLine; $isCurrentPod=$serverProcess.ProcessName -eq 'node' -and $commandLine.IndexOf($serverEntry,[StringComparison]::OrdinalIgnoreCase) -ge 0; if(-not $isCurrentPod){ Write-Host 'Port 8787 is used by another program. It was not stopped.' -ForegroundColor Red; Write-Host $commandLine; exit 1 }; try { Stop-Process -Id $serverPid -Force -ErrorAction Stop; $serverProcess.WaitForExit(5000) | Out-Null } catch { Write-Host 'Unable to stop the existing POD server. Run start.cmd as administrator once.' -ForegroundColor Red; exit 1 } }" ^
  "Start-Process -FilePath 'node' -ArgumentList @((Join-Path $root 'server\index.js')) -WorkingDirectory $root -WindowStyle Hidden; $healthy=$false; for($i=0;$i -lt 30;$i++){ Start-Sleep -Milliseconds 500; try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 ($url+'api/health'); if($r.StatusCode -eq 200){$healthy=$true;break} } catch {} }" ^
  "if(-not $healthy){ Write-Host 'POD server failed to start on 127.0.0.1:8787.' -ForegroundColor Red; exit 1 }; Start-Process $url"

if errorlevel 1 pause
endlocal
