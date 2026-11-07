"use client";

import { FormEvent, UIEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

type Msg = {
  id: string;
  text: string;
  status: "new" | "done";
  result: string | null;
  created_at: string;
  done_at: string | null;
  agent?: string;
  result_status?: "draft" | "published" | "retracted" | null;
  read_at?: string | null;
};

/** Owner sees a PUBLISHED result -> mark read (locks retract/edit). Drafts stay editable. */
const readSent = new Set<string>();
function markPublishedRead(list: Msg[]) {
  for (const m of list) {
    if (m.result_status === "published" && !m.read_at && !readSent.has(m.id)) {
      readSent.add(m.id);
      fetch(`/api/messages/${m.id}/read`, { method: "POST", credentials: "include" }).catch(() => {
        readSent.delete(m.id);
      });
    }
  }
}

function resultLabel(m: Msg): string {
  if (m.result_status === "draft") return "Entwurf (Muse kann noch ändern/zurückziehen)";
  if (m.result_status === "retracted") return "Von Muse zurückgezogen";
  if (m.result_status === "published") return m.read_at ? "Veröffentlicht · gelesen" : "Veröffentlicht";
  return "";
}

type Agent = {
  id: string;
  name: string;
  status: "active" | "recent" | "idle";
  last_activity: string | null;
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleString("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusLabel(s: Agent["status"]) {
  if (s === "active") return "aktiv";
  if (s === "recent") return "kürzlich";
  return "idle";
}

export default function ChatPage() {
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [passcode, setPasscode] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null
  );
  const [messages, setMessages] = useState<Msg[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tab, setTab] = useState<"chat" | "agents">("chat");
  const [quickCmd, setQuickCmd] = useState("");
  const [targetAgent, setTargetAgent] = useState("muse");
  const [polling, setPolling] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/session", {
          credentials: "include",
          cache: "no-store",
        });
        if (!cancelled) setAuthed(res.ok);
      } catch {
        if (!cancelled) setAuthed(false);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!silent) setPolling(true);
    try {
      const res = await fetch(`/api/messages?status=`, {
        credentials: "include",
        cache: "no-store",
      });
      if (res.status === 401) {
        setAuthed(false);
        return;
      }
      if (!res.ok) throw new Error("Laden fehlgeschlagen");
      const data = await res.json();
      setMessages(data.messages ?? []);
      markPublishedRead(data.messages ?? []);
    } finally {
      if (!silent) setPolling(false);
    }
  }, []);

  const loadAgents = useCallback(async () => {
    const res = await fetch("/api/agents", {
      credentials: "include",
      cache: "no-store",
    });
    if (res.status === 401) {
      setAuthed(false);
      return;
    }
    if (!res.ok) throw new Error("Agenten laden fehlgeschlagen");
    const data = await res.json();
    setAgents(data.agents ?? []);
  }, []);

  useEffect(() => {
    if (!authed) return;
    load().catch(() =>
      setFlash({ kind: "err", text: "Verlauf konnte nicht geladen werden." })
    );
    loadAgents().catch(() => {});
    const id = window.setInterval(() => {
      load(true).catch(() => {});
      loadAgents().catch(() => {});
    }, 3000);
    return () => window.clearInterval(id);
  }, [authed, load, loadAgents]);

  useEffect(() => {
    if (stickToBottom.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFlash(null);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ passcode, device_label: "mobile-web" }),
      });
      if (!res.ok) {
        setFlash({ kind: "err", text: "Falscher Zugangscode." });
        return;
      }
      setAuthed(true);
      setPasscode("");
      try {
        sessionStorage.removeItem("muse_api_key");
      } catch {
        /* ignore */
      }
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage(body: { text: string; agent?: string }) {
    const res = await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    if (res.status === 401) {
      setAuthed(false);
      throw new Error("Session abgelaufen");
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Senden fehlgeschlagen.");
    }
  }

  async function onSend(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setFlash(null);
    stickToBottom.current = true;
    try {
      await sendMessage({ text, agent: "muse" });
      setText("");
      await load(true);
    } catch (err) {
      setFlash({
        kind: "err",
        text: err instanceof Error ? err.message : "Senden fehlgeschlagen.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function onQuickCommand(e: FormEvent) {
    e.preventDefault();
    if (!quickCmd.trim()) return;
    setBusy(true);
    setFlash(null);
    try {
      await sendMessage({ text: quickCmd, agent: targetAgent });
      setQuickCmd("");
      setFlash({ kind: "ok", text: `Befehl an ${targetAgent} gesendet.` });
      setTab("chat");
      await load(true);
      await loadAgents();
    } catch (err) {
      setFlash({
        kind: "err",
        text: err instanceof Error ? err.message : "Befehl fehlgeschlagen.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    try {
      sessionStorage.removeItem("muse_api_key");
    } catch {
      /* ignore */
    }
    await fetch("/api/auth", { method: "DELETE", credentials: "include" });
    setAuthed(false);
    setMessages([]);
    setAgents([]);
  }

  function onScroll(e: UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stickToBottom.current = nearBottom;
  }

  const pending = messages.some((m) => m.status === "new");

  return (
    <main className="chat-shell">
      <header className="chat-header">
        <div>
          <p className="chat-kicker">Meta Muse</p>
          <h1>Chat</h1>
          <p className="sub chat-sub">
            Mobil nutzbar nach Pairing. Nachrichten an Muse; Antworten erscheinen,
            sobald Muse sie über MCP zurückschreibt.
          </p>
        </div>
        <div className="chat-header-actions">
          <Link href="/pair" className="chat-link">
            Koppeln
          </Link>
          <Link href="/" className="chat-link">
            Inbox
          </Link>
          {authed && (
            <button type="button" className="secondary" onClick={logout}>
              Abmelden
            </button>
          )}
        </div>
      </header>

      {checking ? (
        <p className="sub">Session wird geprüft…</p>
      ) : !authed ? (
        <div className="card chat-login">
          <form onSubmit={onLogin}>
            <label htmlFor="passcode">Zugangscode</label>
            <input
              id="passcode"
              type="password"
              autoComplete="current-password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder="API-Schlüssel / Passcode"
              required
            />
            <div className="row">
              <button type="submit" disabled={busy}>
                Entsperren
              </button>
              <Link href="/pair" className="chat-link">
                Per QR koppeln
              </Link>
            </div>
          </form>
          {flash && <div className={`msg ${flash.kind}`}>{flash.text}</div>}
        </div>
      ) : (
        <>
          <nav className="chat-tabs" aria-label="Ansichten">
            <button
              type="button"
              className={tab === "chat" ? "tab active" : "tab"}
              onClick={() => setTab("chat")}
            >
              Chat
            </button>
            <button
              type="button"
              className={tab === "agents" ? "tab active" : "tab"}
              onClick={() => setTab("agents")}
            >
              Agenten
            </button>
          </nav>

          {tab === "chat" ? (
            <div className="chat-panel">
              <div className="chat-status">
                <span className={`dot ${pending ? "pulse" : ""}`} />
                {pending
                  ? "Warte auf Muse…"
                  : polling
                    ? "Aktualisiere…"
                    : "Bereit"}
              </div>

              <div className="chat-thread" onScroll={onScroll}>
                {messages.length === 0 && (
                  <div className="chat-empty">
                    Noch keine Nachrichten. Schreibe Muse etwas.
                  </div>
                )}
                {messages.map((m) => (
                  <div key={m.id} className="chat-pair">
                    <div className="bubble me">
                      <div className="bubble-label">
                        Du{m.agent && m.agent !== "muse" ? ` → ${m.agent}` : ""}
                      </div>
                      <div className="bubble-body">{m.text}</div>
                      <div className="bubble-meta">{formatTime(m.created_at)}</div>
                    </div>
                    {m.status === "done" && m.result ? (
                      <div className="bubble muse">
                        <div className="bubble-label">
                          Muse{resultLabel(m) ? ` · ${resultLabel(m)}` : ""}
                        </div>
                        <div className="bubble-body">{m.result}</div>
                        <div className="bubble-meta">
                          {m.done_at ? formatTime(m.done_at) : "erledigt"}
                        </div>
                      </div>
                    ) : m.status === "done" ? (
                      <div className="bubble muse muted">
                        <div className="bubble-label">Muse</div>
                        <div className="bubble-body">
                          {m.result_status === "retracted"
                            ? "Muse hat diese Antwort zurückgezogen."
                            : "Erledigt (ohne Text)."}
                        </div>
                      </div>
                    ) : (
                      <div className="bubble muse pending">
                        <div className="bubble-label">Muse</div>
                        <div className="bubble-body">
                          <span className="typing">
                            <i />
                            <i />
                            <i />
                          </span>
                          denkt nach…
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>

              {flash && <div className={`msg ${flash.kind}`}>{flash.text}</div>}

              <form className="chat-composer" onSubmit={onSend}>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Nachricht an Muse…"
                  rows={2}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (!busy && text.trim()) {
                        (
                          e.currentTarget.form as HTMLFormElement | null
                        )?.requestSubmit();
                      }
                    }
                  }}
                  required
                />
                <button type="submit" disabled={busy || !text.trim()}>
                  Senden
                </button>
              </form>
            </div>
          ) : (
            <div className="agents-panel card">
              <h2 className="agents-title">Agenten</h2>
              <p className="sub" style={{ marginBottom: "1rem" }}>
                Lokale PC-/Helium-Agenten brauchen den Tunnel auf Stefans Rechner.
                Hier: Muse (Cloud).
              </p>
              <ul className="agents-list">
                {agents.map((a) => (
                  <li key={a.id} className="agent-item">
                    <div>
                      <strong>{a.name}</strong>
                      <div className="meta">
                        Status: {statusLabel(a.status)}
                        {a.last_activity
                          ? ` · zuletzt ${formatTime(a.last_activity)}`
                          : " · noch keine Aktivität"}
                      </div>
                    </div>
                    <span className={`badge ${a.status === "active" ? "done" : ""}`}>
                      {a.id}
                    </span>
                  </li>
                ))}
                {agents.length === 0 && (
                  <li className="sub">Keine Agenten geladen.</li>
                )}
              </ul>

              <form className="quick-cmd" onSubmit={onQuickCommand}>
                <label htmlFor="agent">Ziel-Agent</label>
                <select
                  id="agent"
                  value={targetAgent}
                  onChange={(e) => setTargetAgent(e.target.value)}
                >
                  {(agents.length ? agents : [{ id: "muse", name: "Muse" }]).map(
                    (a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    )
                  )}
                </select>
                <label htmlFor="qcmd">Schnellbefehl</label>
                <input
                  id="qcmd"
                  type="text"
                  value={quickCmd}
                  onChange={(e) => setQuickCmd(e.target.value)}
                  placeholder="Befehl an Agent…"
                  required
                />
                <div className="row">
                  <button type="submit" disabled={busy || !quickCmd.trim()}>
                    An Agent senden
                  </button>
                </div>
              </form>
              {flash && <div className={`msg ${flash.kind}`}>{flash.text}</div>}
            </div>
          )}
        </>
      )}
    </main>
  );
}
