# Create/overwrite desktop shortcut "POD Workbench" -> start.cmd
# ASCII shortcut name avoids encoding issues on Chinese Windows cmd.
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
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
Write-Host "Double-click the desktop icon next time."
Write-Host "Re-run this installer after moving the project folder."
exit 0
