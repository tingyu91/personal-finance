# Stops Tally and stops it starting when you sign in. Your data, statements and settings are untouched.
#
#   npm run service:uninstall

$ErrorActionPreference = 'Stop'
if (Get-ScheduledTask -TaskName 'Tally' -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName 'Tally'
  Unregister-ScheduledTask -TaskName 'Tally' -Confirm:$false
}
Get-NetTCPConnection -LocalPort 5317 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
if (Get-Service tally -ErrorAction SilentlyContinue) {
  Write-Host 'Removing the old Tally Windows service; Windows will ask for admin rights.'
  Start-Process powershell -Verb RunAs -Wait -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'Stop-Service tally -ErrorAction SilentlyContinue; sc.exe delete tally | Out-Null')
}
Write-Host 'Tally no longer starts when you sign in.'
