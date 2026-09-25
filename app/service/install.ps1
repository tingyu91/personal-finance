# Starts Tally automatically when you sign in to Windows, serving http://127.0.0.1:5317.
#
#   npm run service:install
#
# A scheduled task, not a Windows service: a service must log on with a stored password, and a
# Microsoft account that signs in with a PIN or Windows Hello often has none Windows can check.
# The task runs as you, only while you are signed in (the only time Tally is used), with no
# window, no password and no admin rights. Re-run this after pulling new code to rebuild and
# restart.

$ErrorActionPreference = 'Stop'
$App = Split-Path -Parent $PSScriptRoot
$Logs = Join-Path $PSScriptRoot 'logs'
$TaskName = 'Tally'
$Url = 'http://127.0.0.1:5317/'

# An earlier version installed a Windows service called "tally". Remove it (needs admin once).
if (Get-Service tally -ErrorAction SilentlyContinue) {
  Write-Host 'Removing the old Tally Windows service; Windows will ask for admin rights.'
  $p = Start-Process powershell -Verb RunAs -Wait -PassThru -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'Stop-Service tally -ErrorAction SilentlyContinue; sc.exe delete tally | Out-Null')
  if (Get-Service tally -ErrorAction SilentlyContinue) { Write-Host 'The old service is still there. Remove it later with: sc.exe delete tally (as admin).' -ForegroundColor Yellow }
}
Remove-Item -Recurse -Force (Join-Path $PSScriptRoot 'bin') -ErrorAction SilentlyContinue

# Stop a running copy so the new build takes over port 5317.
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName $TaskName }
Get-NetTCPConnection -LocalPort 5317 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

Write-Host 'Building Tally...'
Push-Location $App
try { npm run build; if ($LASTEXITCODE) { throw 'The build failed; nothing was changed.' } } finally { Pop-Location }
if (-not (Test-Path (Join-Path $App 'node_modules\tsx'))) { throw "tsx is missing. Run npm install in $App first." }

New-Item -ItemType Directory -Force $Logs | Out-Null
$node = (Get-Command node).Source
# conhost --headless runs the console app with no window; cmd only redirects its output to the log.
$run = "`"$node`" --import tsx src\server\main.ts --static >> `"$Logs\tally.log`" 2>&1"
$action = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument "--headless cmd.exe /d /c $run" -WorkingDirectory $App
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Description "Tally: your statements, locally, at $Url (127.0.0.1 only)." `
  -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

for ($i = 0; $i -lt 30; $i++) {
  try {
    Invoke-WebRequest -UseBasicParsing "${Url}api/health" -TimeoutSec 2 | Out-Null
    Write-Host "Tally is running at $Url and starts each time you sign in."
    exit 0
  } catch { Start-Sleep -Seconds 2 }
}
Write-Host "The task is set up but $Url did not answer within a minute. See $Logs\tally.log." -ForegroundColor Yellow
exit 1
