<#

.SYNOPSIS

  Installiert Cua Driver (user-level) und startet die Muse PC-Bridge auf Port 3420.



.NOTES

  - Kein Administrator nötig (wo möglich).

  - Berührt NICHT OpenBot-v2 / Helium-Profil.

  - Nutzt NICHT restart-server.ps1.

  - Stoppt Connect (Port 3101) NICHT.

  - Cloudflared-Tunnel für 3101 bleibt unverändert; 3420 braucht optional

    einen zweiten Hostname (siehe README.md).

#>



[CmdletBinding()]

param(

  [string]$BridgeDir = $PSScriptRoot,

  [int]$Port = 3420,

  [switch]$SkipCuaInstall,

  [switch]$NoAutostart

)



$ErrorActionPreference = "Stop"



function Write-Info([string]$msg) { Write-Host "[muse-pc-bridge] $msg" -ForegroundColor Cyan }

function Write-Warn([string]$msg) { Write-Host "[muse-pc-bridge] $msg" -ForegroundColor Yellow }

function Write-Err([string]$msg)  { Write-Host "[muse-pc-bridge] $msg" -ForegroundColor Red }



Write-Info "Bridge-Verzeichnis: $BridgeDir"

Write-Info "Ziel-Port: $Port (Connect/OpenBot auf 3101 wird nicht angefasst)"



# --- Guard: OpenBot / Helium / Connect nicht anfassen ---

$forbiddenHints = @(

  "OpenBot-v2-Helium",

  "restart-server.ps1",

  "Helium"

)

foreach ($h in $forbiddenHints) {

  if ($BridgeDir -like "*$h*") {

    Write-Err "Abbruch: BridgeDir scheint unter OpenBot/Helium zu liegen ($h). Bitte separat installieren."

    exit 1

  }

}



# --- Node prüfen ---

$node = Get-Command node -ErrorAction SilentlyContinue

if (-not $node) {

  Write-Err "Node.js (>=18) fehlt. Bitte von https://nodejs.org (User-Installer, ohne Admin) installieren und PowerShell neu öffnen."

  exit 1

}

$nodeVer = & node -v

Write-Info "Node gefunden: $nodeVer ($($node.Source))"



# --- .pc-key sicherstellen (nicht ausgeben) ---

$keyFile = Join-Path $BridgeDir ".pc-key"

if (-not (Test-Path $keyFile)) {

  Write-Info "Erzeuge .pc-key (wird nicht angezeigt)..."

  $bytes = New-Object byte[] 48

  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)

  $key = [Convert]::ToBase64String($bytes) -replace '[+/=]', 'x'

  # ACL: nur aktueller User (entspricht mode 600)

  Set-Content -Path $keyFile -Value $key -NoNewline -Encoding ASCII

  try {

    icacls $keyFile /inheritance:r | Out-Null

    icacls $keyFile /grant:r "$($env:USERNAME):(R,W)" | Out-Null

  } catch {

    Write-Warn "Konnte ACL auf .pc-key nicht setzen: $($_.Exception.Message)"

  }

} else {

  Write-Info ".pc-key vorhanden (Inhalt wird nicht gelesen/ausgegeben)."

}



# --- Cua Driver installieren ---

if (-not $SkipCuaInstall) {

  $cua = Get-Command cua-driver -ErrorAction SilentlyContinue

  if (-not $cua) {

    Write-Info "Installiere Cua Driver (offizielles user-level Script, kein Admin)..."

    Write-Info "Quelle: https://cua.ai/driver/install.ps1"

    try {

      & ([scriptblock]::Create((irm https://cua.ai/driver/install.ps1)))

    } catch {

      Write-Err "Cua-Installer fehlgeschlagen: $($_.Exception.Message)"

      Write-Warn "Manuell: irm https://cua.ai/driver/install.ps1 | iex"

      exit 1

    }

    # PATH der aktuellen Session aktualisieren (Installer schreibt User-PATH)

    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "User") + ";" +

                [System.Environment]::GetEnvironmentVariable("Path", "Machine")

    $cua = Get-Command cua-driver -ErrorAction SilentlyContinue

  } else {

    Write-Info "cua-driver bereits im PATH: $($cua.Source)"

  }



  if (-not $cua) {

    Write-Warn "cua-driver nach Install nicht im PATH. Neue PowerShell öffnen und 'cua-driver status' prüfen."

  } else {

    Write-Info "Starte Cua Driver Autostart (Kick) — Desktop-Session nötig..."

    try {

      & cua-driver autostart kick 2>$null

    } catch {

      Write-Warn "autostart kick fehlgeschlagen — Fallback: in einer Desktop-Konsole 'cua-driver serve' laufen lassen."

    }

    try {

      & cua-driver status

    } catch {

      Write-Warn "cua-driver status fehlgeschlagen. Später 'cua-driver doctor' ausführen."

    }

  }

} else {

  Write-Info "SkipCuaInstall gesetzt — Cua wird nicht installiert/gestartet."

}



# --- Port 3420 prüfen (3101 nicht anfassen) ---

try {

  $inUse = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue

  if ($inUse) {

    Write-Warn "Port $Port horcht bereits. Falls das die Bridge ist: ok. Sonst anderen Port wählen."

  }

} catch {

  # Get-NetTCPConnection braucht ggf. Admin — ignorieren

}



# Connect/3101 nur melden, nie stoppen

try {

  $c3101 = Get-NetTCPConnection -LocalPort 3101 -State Listen -ErrorAction SilentlyContinue

  if ($c3101) {

    Write-Info "Connect/OpenBot auf Port 3101 läuft — bleibt unberührt."

  }

} catch { }



# --- Bridge starten ---

$serverJs = Join-Path $BridgeDir "server.js"

if (-not (Test-Path $serverJs)) {

  Write-Err "server.js fehlt in $BridgeDir"

  exit 1

}



$env:PC_BRIDGE_PORT = "$Port"

$env:PC_BRIDGE_KEY_FILE = $keyFile

# Explizit KEIN Lesen/Echo des Keys




# Optional CUA_API_KEY: if .env exists, Node loads it; local cua-driver MCP does not require it.
if (Test-Path (Join-Path $BridgeDir ".env")) {
  Write-Info ".env gefunden (gitignored). CUA_API_KEY wird ggf. an cua-driver vererbt — Inhalt nicht ausgegeben."
} else {
  Write-Info "Kein .env — optional später aus .env.example kopieren (CUA_API_KEY nur für Cua-Cloud/Relay)."
}

Write-Info "Starte Bridge: node server.js"

$proc = Start-Process -FilePath $node.Source -ArgumentList @($serverJs) `

  -WorkingDirectory $BridgeDir `

  -WindowStyle Minimized `

  -PassThru



Start-Sleep -Seconds 2

$keyForTest = (Get-Content -Path $keyFile -Raw).Trim()

try {

  $headers = @{ Authorization = "Bearer $keyForTest" }

  $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -Headers $headers -TimeoutSec 5

  Write-Info "Health OK: service=$($health.service) cuaAlive=$($health.cuaAlive)"

} catch {

  Write-Warn "Health-Check noch nicht ok: $($_.Exception.Message)"

  Write-Warn "Process-Id der Bridge: $($proc.Id) — Logs im Bridge-Fenster prüfen."

} finally {

  # Key aus Speicher möglichst nicht länger halten

  $keyForTest = $null

  $headers = $null

}



if (-not $NoAutostart) {

  # User-level Scheduled Task (LogonType Interactive), ohne Admin wo möglich

  $taskName = "MusePcBridge"

  $action = New-ScheduledTaskAction -Execute $node.Source -Argument "`"$serverJs`"" -WorkingDirectory $BridgeDir

  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

  try {

    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null

    Write-Info "Autostart-Task '$taskName' registriert (AtLogOn, aktueller User)."

  } catch {

    Write-Warn "Scheduled Task fehlgeschlagen (kein Admin?): $($_.Exception.Message)"

    Write-Warn "Bridge manuell starten: cd `"$BridgeDir`"; node server.js"

  }

}



Write-Host ""

Write-Info "Fertig."

Write-Host @"



Nächste Schritte (Tunnel, ohne 3101 zu ändern):

  1) Cloudflare Zero Trust → Networks → Tunnels → bestehenden Tunnel öffnen

  2) Public Hostname HINZUFÜGEN (nicht den 3101-Eintrag editieren):

       Subdomain z.B. muse-pc

       Domain: deine Domain

       Service: http://127.0.0.1:$Port

  3) In Vercel (muse-inbox-v3 Preview) Env setzen:

       PC_BRIDGE_URL = https://muse-pc.<deine-domain>

       PC_BRIDGE_KEY = (Inhalt von $keyFile — nur lokal kopieren, nie committen)

  4) Test: curl https://prototyping-muse.vercel.app/api/pc/status -H "Authorization: Bearer <API_KEY>"



"@

