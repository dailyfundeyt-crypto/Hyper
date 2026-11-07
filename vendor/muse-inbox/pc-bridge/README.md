# Muse PC-Bridge (Cua Driver)

Lokale Brücke auf Stefans Windows-PC: startet **Cua Driver MCP über stdio** und stellt ihn als **Streamable HTTP MCP** auf `http://127.0.0.1:3420` bereit.

Cloud-Seite (Vercel Preview `muse-inbox-v3` / Alias `https://prototyping-muse.vercel.app`) proxyt unter `/api/pc/mcp` mit dem bestehenden Muse-`API_KEY` und leitet an diese Bridge weiter (`PC_BRIDGE_URL` + `PC_BRIDGE_KEY`).

## Was das ist / was das nicht ist

| | |
|---|---|
| **Ja** | Cua Driver installieren (User-Level), Bridge auf Port **3420**, optional zweiter Cloudflare-Hostname |
| **Nein** | OpenBot-v2 / Helium-Profil anfassen |
| **Nein** | `restart-server.ps1` nutzen |
| **Nein** | Connect-Server auf Port **3101** stoppen oder umbiegen |
| **Nein** | `vercel --prod` / Promote |

## Voraussetzungen

- Windows 10/11, **angemeldete Desktop-Session** (nicht Session 0 / reines SSH)
- Node.js ≥ 18 (User-Installer von nodejs.org reicht)
- Cua Driver (das Install-Script holt ihn von `https://cua.ai/driver/install.ps1`)

### Cua Driver — Fakten (Stand Docs cua.ai)

- **Windows:** unterstützt (Windows 10/11/Server, interaktive Desktop-Session). Quelle: [Cua Driver](https://cua.ai/docs/cua-driver), [Quickstart](https://cua.ai/docs/cua-driver/quickstart)
- **Install (kein Admin nötig):** `irm https://cua.ai/driver/install.ps1 | iex` danach `cua-driver autostart kick`
- **MCP Transport:** primär **stdio** via `cua-driver mcp`. Optional nativer HTTP-Listener über `CUA_DRIVER_RS_MCP_HTTP_PORT` + `CUA_DRIVER_RS_MCP_HTTP_TOKEN` (`POST http://127.0.0.1:<port>/mcp`). Quelle: [Tools and MCP](https://cua.ai/docs/cua-driver/reference/cli/mcp), [SDK/MCP/Hosting](https://cua.ai/docs/concepts/sdk-mcp-and-hosting)
- Diese Bridge nutzt absichtlich **stdio** und spricht selbst Streamable HTTP auf 3420 mit `Authorization: Bearer <PC_BRIDGE_KEY>`.

### Wichtige MCP-Tool-Namen (Auszug)

`list_apps`, `list_windows`, `launch_app`, `get_window_state`, `get_desktop_state`, `click`, `type_text`, `press_key`, `hotkey`, `browser_prepare`, `get_browser_state`, `browser_navigate`, `browser_click`, `browser_type`, `start_session`, `end_session`, `health_report`, …  
Vollständige Liste: [All tools](https://cua.ai/docs/cua-driver/reference/mcp-tools)

## Schnellstart auf dem PC

1. Diesen Ordner `pc-bridge/` nach Windows kopieren, z. B. nach  
   `C:\Users\Kunc GmbH\muse-pc-bridge`  
   (**nicht** unter `Downloads\OpenBot-v2-Helium`).
2. PowerShell (normale User-Session):

```powershell
cd C:\Users\Kunc GmbH\muse-pc-bridge
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned   # falls nötig
.\install-cua-bridge.ps1
```

Das Script:

- installiert Cua Driver (user-level), sofern nicht vorhanden
- erzeugt `.pc-key` falls fehlend (ACL nur aktueller User; Inhalt wird nicht ausgegeben)
- startet `node server.js` auf Port 3420
- registriert optional einen Logon-Scheduled-Task `MusePcBridge`
- **ändert 3101 / OpenBot / Helium nicht**

Nur Bridge neu starten (Cua schon da):

```powershell
cd C:\Users\Kunc GmbH\muse-pc-bridge
$env:PC_BRIDGE_KEY_FILE = "$PWD\.pc-key"
node server.js
```

Health (Key lokal einsetzen, nicht committen):

```powershell
$key = Get-Content .\.pc-key -Raw   # Pfad: .\.pc-key
Invoke-RestMethod http://127.0.0.1:3420/health -Headers @{ Authorization = "Bearer $key" }
```

## Tunnel: 3420 freigeben, ohne 3101 zu ändern

Stefans bestehender Cloudflare-Tunnel zeigt Connect/OpenBot auf **Port 3101**  
(`C:\Users\Kunc GmbH\Downloads\OpenBot-v2-Helium`). Diesen Eintrag **nicht** umbiegen.

Stattdessen einen **zweiten Public Hostname** am selben Tunnel anlegen:

1. Cloudflare Zero Trust → **Networks** → **Tunnels** → bestehenden Tunnel wählen  
2. **Public Hostname** → **Add** (nicht den 3101-Hostname editieren)  
3. Beispiel:

| Feld | Wert |
|------|------|
| Subdomain | `muse-pc` |
| Domain | deine bestehende Domain |
| Type | HTTP |
| URL | `127.0.0.1:3420` |

Ergebnis: `https://muse-pc.<domain>` → Bridge, während `…:3101` / alter Hostname unverändert Connect bleibt.

Alternative per `config.yml` (zweiter ingress, **vor** dem catch-all):

```yaml
ingress:
  - hostname: connect.example.com
    service: http://127.0.0.1:3101
  - hostname: muse-pc.example.com
    service: http://127.0.0.1:3420
  - service: http_status:404
```

cloudflared danach nur neu laden / Ingress speichern — Connect-Prozess nicht stoppen.

## Vercel Env (Preview-Projekt `muse-inbox-v3`)

| Variable | Wert |
|----------|------|
| `PC_BRIDGE_URL` | `https://muse-pc.<domain>` (ohne trailing slash; zeigt auf Tunnel→3420) |
| `PC_BRIDGE_KEY` | Inhalt von `pc-bridge/.pc-key` |

Bestehende `API_KEY` bleibt der Muse-Inbox-Auth-Key für `/api/pc/*`.

Cloud-Endpunkte:

- `GET  /api/pc/status` — Online-Check (`{ online: true }` oder `{ error: "PC offline" }`)
- `POST /api/pc/mcp` — MCP-Proxy (Bearer/`?key=` = Muse `API_KEY`)


## Cua API-Key (`CUA_API_KEY`) — optional

Stefan hat einen Cua-API-Key. Für **dieses** Setup (lokaler `cua-driver mcp` + eigener Cloudflare-Tunnel auf Port 3420) wird er **nicht** benötigt.

| Wo | Env-Name | Wann |
|----|----------|------|
| PC-Bridge (`pc-bridge/.env`, mode 600, gitignored) | `CUA_API_KEY` | Nur wenn später Cua-Cloud / Spaces / Relay / Sandbox-SDK von diesem Host genutzt wird |
| PC User-Env / Scheduled Task | `CUA_API_KEY` | Gleiches; `server.js` lädt `.env` und vererbt `CUA_*` an `cua-driver` |
| Vercel (`muse-inbox-v3`) | `CUA_API_KEY` | **Nicht** für `/api/pc/*` nötig. Nur setzen, wenn eine Cloud-Route direkt Cua-APIs aufruft (tut sie derzeit nicht) |
| Vercel | `PC_BRIDGE_URL`, `PC_BRIDGE_KEY` | **Pflicht** für den PC-Proxy |

Hinweise aus der Cua-Doku:

- Lokaler **Cua Driver** (stdio/HTTP MCP) authentifiziert sich nicht per `CUA_API_KEY`; Desktop-Steuerung läuft ohne Cloud.
- `CUA_API_KEY` gehört historisch zum älteren VM-/Sandbox-API-Pfad; aktuelles Fleet/Cloud nutzt eher `cua auth login`, `FLEETS_TOKEN` oder `CUA_CLIENT_ID`/`CUA_CLIENT_SECRET`. Cua Cloud (Fleets) endete laut Docs am 16.10.2026.
- Relay-Tokens heißen ggf. `CUA_RELAY_TOKEN` / `CUA_RELAY_URL` — nicht mit `PC_BRIDGE_KEY` verwechseln.

Niemals den Key committen. Vorlage: `.env.example`. Geheimnisse nur in `.env` / `.pc-key` (beide gitignored, mode 600).

## Sicherheit

- Bridge lauscht standardmäßig nur auf `127.0.0.1`.
- Jeder Request braucht `Authorization: Bearer <PC_BRIDGE_KEY>`.
- `.pc-key` nie committen (steht in `pc-bridge/.gitignore`).
- Tunnel nur mit HTTPS-Hostname + starkem Key; Key Rotation = neue `.pc-key` + Vercel-Env.

## Troubleshooting

| Symptom | Aktion |
|---------|--------|
| `PC offline` von Vercel | Bridge/Tunnel prüfen: lokal `/health`, cloudflared Hostname→3420 |
| `cua-driver spawn error` | `cua-driver` im PATH? Neue Shell; `cua-driver doctor` |
| Leere App-Liste | Desktop-Session? `cua-driver autostart kick` bzw. `cua-driver serve` im Desktop |
| Port 3420 belegt | Anderen Port: `$env:PC_BRIDGE_PORT=3421; node server.js` + Tunnel anpassen |
