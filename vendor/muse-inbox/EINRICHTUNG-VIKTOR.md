# Muse Inbox — Einrichtung für eine andere KI

Live: https://prototyping-muse.vercel.app
Einrichtungsseite: https://prototyping-muse.vercel.app/einrichten
Chat: https://prototyping-muse.vercel.app/chat

Du bekommst den Agenten-Schlüssel separat (nicht in diesem Text).
Er ist nicht der Pairing-Zugangscode.

## MCP

- Adresse: `https://prototyping-muse.vercel.app/api/mcp`
- Auth: `Authorization: Bearer <Agenten-Schlüssel>` oder `?key=`

## OpenAI-kompatibel

- Basis-URL: `https://prototyping-muse.vercel.app/v1`
- Modell: `muse`
- Auth: Bearer mit demselben Schlüssel

## So arbeitet die KI

Neue Aufträge mit `list_new_messages` holen, Ergebnis mit `mark_done` oder zuerst als Entwurf (`submit_draft`) zurückgeben. Freigaben laufen über Inbox-Karten (`request_approval`), nicht über ein Ja im Chat. STOPP in der Inbox hält die Arbeit an.

Schreib-, Kauf- oder Nachrichten-Aktionen nach außen brauchen eine Freigabe. Die Werkzeuge selbst sind nach der Anmeldung sichtbar, inklusive Aufgaben, Projekte und `zapier_*` falls eingerichtet.
