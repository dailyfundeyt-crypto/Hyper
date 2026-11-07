# Muse Inbox

Deutsche Web-Eingabe + REST + Streamable-HTTP-MCP für Meta Muse (meta.ai).

## Live (Preview)

- **Alias:** https://prototyping-muse.vercel.app
- **Pairing (Desktop-QR):** https://prototyping-muse.vercel.app/pair
- **Chat / Agenten:** https://prototyping-muse.vercel.app/chat
- **API-Base:** https://prototyping-muse.vercel.app/api
- **MCP:** `https://prototyping-muse.vercel.app/api/mcp?key=YOUR_API_KEY` (Bearer/`?key=` only — no session cookie)
- Vercel-Projekt: `muse-inbox-v3` (Team stefans-projects-e40bb777) — Preview only, never `--prod`
- Deployment Protection / SSO: **aus**
- API-Key: `/workspace/muse-inbox/.key` (auch in `.env.local` und Vercel-Env `API_KEY`)


## OpenAI-kompatible API (Custom Provider)

- **Base URL:** `https://prototyping-muse.vercel.app/v1`
- **Model:** `muse`
- **Auth:** `Authorization: Bearer <API_KEY>`
- Endpunkte: `GET /v1/models`, `POST /v1/chat/completions` (inkl. `stream`), `GET /v1/messages/{id}`, `POST /v1/files`, `POST /v1/uploads`
- Anhänge (Bilder/Dateien/Video) → privater Bucket `muse-attachments`; Muse sieht signierte URLs (7 Tage) in `list_new_messages` / `GET /api/messages`
- Kurzanleitung (DE): `/workspace/muse-doc/muse-api-anleitung.md`

## Chat (lokal)

- Route: `/chat` — dunkle Chat-UI (Deutsch), pollt alle 3s, lädt Verlauf aus Supabase
- Lokal: `PORT=3300 npm run start` → http://127.0.0.1:3300/chat
- Echte Antworten erscheinen erst, wenn Meta Muse `list_new_messages` / `mark_done` aufruft

## Lokal

```bash
cp .env.local.example .env.local
npm install
npm run dev
```

## Auth

- REST (`/api/messages`, `/api/agents`, `/api/session`, …): Bearer/`?key=` **oder** httpOnly `muse_session` Cookie (30 Tage nach Pairing)
- MCP (`/api/mcp`): nur Bearer/`?key=` (unverändert)
- Zugangscode = `API_KEY` (einmal beim Pairing-Approve)

## Helium-Connect-Style Pairing

1. Desktop öffnet `/pair` → kurzer Pairing-Token (5 Min) + QR auf `…/pair/approve?t=…`
2. Phone scannt, gibt Zugangscode ein, freigibt → beide Geräte bekommen `muse_session`
3. Danach `/chat` mobil nutzbar (Tabs Chat + Agenten); Quick-Command setzt `agent` (default `muse`)

Supabase: Tabelle `muse_pairings` + RPCs; Spalte `muse_inbox_messages.agent` (default `muse`). Additive Migration, RLS an.

## REST

```bash
KEY=$(cat /workspace/muse-inbox/.key)
BASE=https://prototyping-muse.vercel.app

# Anlegen
curl -sS "$BASE/api/messages" -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" -d '{"text":"Hallo Muse"}'

# Neue listen
curl -sS "$BASE/api/messages?status=new" -H "Authorization: Bearer $KEY"

# Erledigen
curl -sS -L "$BASE/api/messages/<ID>/result" -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" -d '{"result":"Fertig"}'
```

Optional: `WEBHOOK_URL` — bei Create POST der Nachricht an diese URL.

## MCP (tools/list + tools/call)

```bash
curl -sS "$BASE/api/mcp?key=$KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

curl -sS "$BASE/api/mcp?key=$KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_new_messages","arguments":{}}}'

curl -sS "$BASE/api/mcp?key=$KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"mark_done","arguments":{"id":"<UUID>","result":"..."}}}'
```

Tools: `list_new_messages`, `mark_done(id, result)`.

## Supabase

- Neues Projekt **muse-inbox**, ref `iasiyjghlrjpxhnlhtsc`, Region eu-central-1
- Tabelle `muse_inbox_messages` (RLS an)
- Zugriff nur über SECURITY-DEFINER-RPCs (`muse_list_messages`, `muse_create_message`, `muse_mark_done`) + Anon-Key serverseitig
- Keine Connect-Tabellen angefasst

## Hinweise

- Preview-Deployment (`target=null`); kein `vercel --prod`. Frühere Projekte `muse-inbox` / `muse-inbox-v2` sind Altlasten (falsche/fehlende Env) und können gelöscht werden.
- MCP ist key-basiert (Bearer/`?key=`), kein Zapier-OAuth-Flow — für Muse Custom Connector mit Query-Key gedacht.

## PC-Bridge (Cua Driver)

Meta Muse steuert Stefans Windows-Browser über Cua Driver. Neue Dateien (kein Konflikt mit Pair/Chat-Arbeit):

- Cloud: `src/app/api/pc/mcp`, `src/app/api/pc/status`, `src/lib/pc-bridge.ts`
- PC: Ordner `pc-bridge/` (Node-Bridge auf Port **3420**, Installer `install-cua-bridge.ps1`, README auf Deutsch)

**Nicht deployen hier** — anderer Worker deployed Preview. Env auf Vercel (`muse-inbox-v3`):

- `PC_BRIDGE_URL` — öffentlicher HTTPS-URL des Tunnels auf `127.0.0.1:3420` (zweiter Cloudflare-Hostname; **3101/Connect unverändert**)
- `PC_BRIDGE_KEY` — Inhalt von `pc-bridge/.pc-key` (nie committen)

Auth für `/api/pc/*`: bestehender Muse-`API_KEY` (Bearer / `?key=`). Unerreichbare Bridge → JSON `{ "error": "PC offline" }`.

Details & manuelle PC-Schritte: [`pc-bridge/README.md`](./pc-bridge/README.md).

Optional (nicht nötig für lokalen Driver + Tunnel): `CUA_API_KEY` — nur falls später Cua-Cloud/Relay/Sandbox von Bridge oder Vercel genutzt wird; siehe `pc-bridge/README.md`. Nie committen (nur gitignored `.env` mode 600).


## Sicherheitsrahmen (2026-10-28)
- Ergebnisse sind Entwürfe (`result_status` draft|published|retracted) – edit/retract bis Stefan ein veröffentlichtes Ergebnis liest.
- Stoppwort `STOPP` / `POST /api/control` (resume nur mit Owner-Key).
- Freigaben: `/api/approvals`, Entscheidung nur Owner (`/approve`).
- Grants `/api/grants`, Budget `/api/budget`.
- Zapier-Proxy in `/api/mcp` (`zapier_*`), serverseitige Grant-Prüfung, Log in `muse_tool_log`. Env: `ZAPIER_MCP_URL`, `ZAPIER_MCP_TOKEN`.
