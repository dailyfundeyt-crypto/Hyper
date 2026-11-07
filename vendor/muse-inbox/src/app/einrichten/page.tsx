import Link from "next/link";

export const metadata = {
  title: "KI einrichten — Muse Inbox",
  description: "Zugang für eine andere KI zur Muse Inbox",
};

export default function EinrichtenPage() {
  return (
    <main>
      <section className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          <Link href="/">Inbox</Link>
          {" · "}
          <Link href="/chat">Chat</Link>
          {" · "}
          <Link href="/pair">Koppeln</Link>
        </p>
        <h1>KI einrichten</h1>
        <p className="muted">
          Hier verbindest du eine andere KI mit dieser Inbox. Den Zugangsschlüssel
          bekommst du separat — er steht nicht auf dieser Seite.
        </p>

        <h2>Als MCP-Server</h2>
        <p>Adresse:</p>
        <pre>https://prototyping-muse.vercel.app/api/mcp</pre>
        <p>
          Anmeldung: Bearer-Token oder Query <code>?key=</code> mit dem Agenten-Schlüssel.
          Session-Cookies funktionieren hier nicht.
        </p>

        <h2>Als OpenAI-kompatibler Anbieter</h2>
        <p>Basis-URL:</p>
        <pre>https://prototyping-muse.vercel.app/v1</pre>
        <p>
          Modellname <code>muse</code>. Derselbe Schlüssel als Bearer-Token.
        </p>

        <h2>Werkzeuge</h2>
        <p>
          Nach der Verbindung stehen die Inbox-Werkzeuge bereit, unter anderem
          <code>list_new_messages</code>, <code>mark_done</code>, <code>submit_draft</code>,
          <code>edit_result</code>, <code>publish_result</code>, <code>request_approval</code>,
          <code>list_open_tasks</code>, <code>complete_task</code>, <code>ask_owner</code>,
          Projekte, Kalender und — falls eingerichtet — die <code>zapier_*</code>-Werkzeuge.
        </p>
        <p className="muted">
          Schreiben, Kaufen oder Nachrichten nach außen brauchen weiterhin eine
          Freigabe in der Inbox. Der Pairing-Zugangscode bleibt der Haupt-Schlüssel
          und ist nicht dieser Agenten-Token.
        </p>
      </section>
    </main>
  );
}
