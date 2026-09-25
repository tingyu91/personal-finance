# Installs Tally as a Windows service that starts with Windows and serves http://127.0.0.1:5317.
#
#   npm run service:install      (asks for admin once, then for your Windows password)
#
# The service runs as your own Windows account, not SYSTEM: the database, vault and settings sit
# in your OneDrive folder, which SYSTEM cannot reliably read. Your password goes to Windows' service
# manager only; nothing here stores it. Re-run this script after pulling new code to rebuild and
# restart. The wrapper is WinSW (github.com/winsw/winsw), pinned to v2.12.0 by its SHA-256.

param([switch]$Elevated, [string]$UserSid)
$ErrorActionPreference = 'Stop'

$App = Split-Path -Parent $PSScriptRoot
$Bin = Join-Path $PSScriptRoot 'bin'
$Logs = Join-Path $PSScriptRoot 'logs'
$Exe = Join-Path $Bin 'tally-service.exe'
$Xml = Join-Path $Bin 'tally-service.xml'
$WinswUrl = 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe'
$WinswSha256 = '05B82D46AD331CC16BDC00DE5C6332C1EF818DF8CEEFCD49C726553209B3A0DA'
$Url = 'http://127.0.0.1:5317/'

# A service can only run as an account holding "Log on as a service" (SeServiceLogonRight).
# WinSW offers to grant it at its prompt; this makes sure, whatever the answer was.
function Grant-ServiceLogon([string]$Sid) {
  $dir = Join-Path $env:TEMP "tally-secedit-$PID"
  New-Item -ItemType Directory -Force $dir | Out-Null
  try {
    $cfg = Join-Path $dir 'current.inf'
    secedit /export /cfg $cfg /areas USER_RIGHTS | Out-Null
    $line = Get-Content $cfg | Where-Object { $_ -match '^SeServiceLogonRight\s*=' }
    if ($line -and ($line -split '[=,]' | ForEach-Object { $_.Trim() }) -contains "*$Sid") { return }
    $holders = if ($line) { "$($line.Split('=', 2)[1].Trim()),*$Sid" } else { "*$Sid" }
    $inf = Join-Path $dir 'grant.inf'
    @('[Unicode]', 'Unicode=yes', '[Version]', 'signature="$CHICAGO$"', 'Revision=1', '[Privilege Rights]', "SeServiceLogonRight = $holders") |
      Set-Content -Encoding Unicode $inf
    secedit /configure /db (Join-Path $dir 'grant.sdb') /cfg $inf /areas USER_RIGHTS | Out-Null
    if ($LASTEXITCODE) { throw 'Could not give your account the "Log on as a service" right.' }
    Write-Host 'Gave your account the "Log on as a service" right.'
  } finally {
    Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue
  }
}

function Test-Admin {
  ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not $Elevated) {
  # Build as you, not as admin, so dist/ stays yours.
  Write-Host 'Building Tally...'
  Push-Location $App
  try { npm run build; if ($LASTEXITCODE) { throw 'The build failed; the service was not installed.' } } finally { Pop-Location }

  New-Item -ItemType Directory -Force $Bin, $Logs | Out-Null
  if (-not (Test-Path $Exe) -or (Get-FileHash $Exe -Algorithm SHA256).Hash -ne $WinswSha256) {
    Write-Host 'Downloading the service wrapper (WinSW v2.12.0)...'
    Invoke-WebRequest -UseBasicParsing -Uri $WinswUrl -OutFile $Exe
    if ((Get-FileHash $Exe -Algorithm SHA256).Hash -ne $WinswSha256) {
      Remove-Item $Exe
      throw 'The downloaded WinSW does not match its expected checksum, so it was deleted.'
    }
  }

  $node = (Get-Command node).Source
  $tsx = Join-Path $App 'node_modules\tsx\dist\loader.mjs'
  if (-not (Test-Path $tsx)) { throw "tsx is missing. Run npm install in $App first." }
  $esc = { param($s) [Security.SecurityElement]::Escape($s) }
  @"
<service>
  <id>tally</id>
  <name>Tally (personal finance)</name>
  <description>Tally reads your bank statements locally and serves $Url. Listens on 127.0.0.1 only.</description>
  <executable>$(& $esc $node)</executable>
  <arguments>--import tsx src/server/main.ts --static</arguments>
  <workingdirectory>$(& $esc $App)</workingdirectory>
  <startmode>Automatic</startmode>
  <delayedAutoStart>true</delayedAutoStart>
  <onfailure action="restart" delay="10 sec"/>
  <onfailure action="restart" delay="60 sec"/>
  <resetfailure>1 hour</resetfailure>
  <stoptimeout>15 sec</stoptimeout>
  <logpath>$(& $esc $Logs)</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>1024</sizeThreshold>
    <keepFiles>3</keepFiles>
  </log>
</service>
"@ | Set-Content -Encoding UTF8 $Xml

  # The account the service runs as: you, even if an admin elevates the install.
  $UserSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  if (-not (Test-Admin)) {
    Write-Host 'Windows will ask for admin rights to install the service.'
    $p = Start-Process powershell -Verb RunAs -Wait -PassThru -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Elevated', '-UserSid', $UserSid)
    if ($p.ExitCode) { throw "The install did not finish (exit code $($p.ExitCode))." }
  }
}

if (Test-Admin) {
  try {
    if (-not $UserSid) { $UserSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value }
    Grant-ServiceLogon $UserSid
    if (Get-Service tally -ErrorAction SilentlyContinue) {
      Write-Host 'Replacing the Tally service already installed...'
      & $Exe stop | Out-Null
      & $Exe uninstall | Out-Null
      Start-Sleep -Seconds 2
    }
    Write-Host ''
    Write-Host "Enter your Windows sign-in, as .\$env:USERNAME, and its password (your Microsoft account password"
    Write-Host 'if you sign in with one, not your PIN). Answer y to allow it to log on as a service.'
    & $Exe install /p
    if ($LASTEXITCODE) { throw 'Windows did not accept the service. Check the account name and password, then run it again.' }
    & $Exe start
    if ($LASTEXITCODE) { throw "The service is installed but did not start. See $Logs." }
  } catch {
    Write-Host $_ -ForegroundColor Red
    if ($Elevated) { Read-Host 'Press Enter to close' }
    exit 1
  }
  # In the separate admin window: done. The first window checks Tally answers.
  if ($Elevated) { exit 0 }
}

# Back in your own window: wait for Tally to answer.
for ($i = 0; $i -lt 30; $i++) {
  try { Invoke-WebRequest -UseBasicParsing "${Url}api/health" -TimeoutSec 2 | Out-Null; Write-Host "Tally is running at $Url and starts with Windows."; exit 0 }
  catch { Start-Sleep -Seconds 2 }
}
Write-Host "The service is installed but $Url did not answer within a minute. See $Logs." -ForegroundColor Yellow
exit 1
