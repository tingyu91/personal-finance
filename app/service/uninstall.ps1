# Stops and removes the Tally Windows service. Your data, statements and settings are untouched.
#
#   npm run service:uninstall

param([switch]$Elevated)
$ErrorActionPreference = 'Stop'
$Exe = Join-Path $PSScriptRoot 'bin\tally-service.exe'

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  Write-Host 'Windows will ask for admin rights to remove the service.'
  $p = Start-Process powershell -Verb RunAs -Wait -PassThru -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Elevated')
  exit $p.ExitCode
}

if (-not (Get-Service tally -ErrorAction SilentlyContinue)) { Write-Host 'The Tally service is not installed.'; exit 0 }
if (Test-Path $Exe) {
  & $Exe stop | Out-Null
  & $Exe uninstall
} else {
  Stop-Service tally -ErrorAction SilentlyContinue
  sc.exe delete tally | Out-Null
}
Write-Host 'Removed the Tally service.'
if ($Elevated) { Start-Sleep -Seconds 2 }
