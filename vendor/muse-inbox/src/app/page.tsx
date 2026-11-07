"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { InsertLinkButton, LinkChips, SummaryCard, type Summary } from "@/components/links-ui";

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
  task_state?: "waiting" | null;
  due_at?: string | null;
  source?: string | null;
  project_id?: string | null;
  activation_id?: string | null;
};

type Note = {
  id: string;
  message_id: string;
  kind: "update" | "question" | "reply";
  author: "muse" | "owner";
  text: string;
  created_at: string;
};

/** Owner sees a PUBLISHED result -> mark read (locks retract/edit). Drafts stay editable. */
const readSent = new Set<string>();
function dayOf(iso: string): string {
  return new Date(iso).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", weekday: "short", day: "2-digit", month: "2-digit" });
}

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

type Approval = {
  id: string;
  message_id: string | null;
  action: string;
  summary: string;
  details?: Record<string, unknown> | null;
  status: "pending" | "approved" | "denied";
  decided_at?: string | null;
  used_at?: string | null;
  used_for?: string | null;
};

const OWNER_STORE = "muse_owner_key";
function readOwnerKey(): string | null {
  try {
    return localStorage.getItem(OWNER_STORE) || sessionStorage.getItem(OWNER_STORE);
  } catch {
    return null;
  }
}

const bigBtn = (bg: string) => ({
  flex: 1,
  minHeight: 64,
  fontSize: "1.35rem",
  fontWeight: 700,
  borderRadius: 14,
  background: bg,
  color: "#fff",
  border: "none",
});

function ApprovalCard({
  a,
  ownerKey,
  busy,
  onDecide,
  onUnlock,
}: {
  a: Approval;
  ownerKey: string | null;
  busy: boolean;
  onDecide: (a: Approval, d: "approved" | "denied") => void;
  onUnlock: (k: string) => void;
}) {
  const [k, setK] = useState("");
  if (a.status !== "pending") {
    return (
      <div className="meta" style={{ marginTop: 8, fontWeight: 600 }}>
        {a.status === "approved" ? "✅ Freigegeben" : "❌ Abgelehnt"} – {a.summary}
        {a.status === "approved" && (a.used_at ? ` · von Muse ausgeführt${a.used_for ? ` (${a.used_for})` : ""}` : " · wartet auf Ausführung durch Muse")}
      </div>
    );
  }
  return (
    <div
      style={{
        marginTop: 10,
        padding: 12,
        borderRadius: 14,
        border: "2px solid #a89bff",
        background: "rgba(168,155,255,.08)",
      }}
    >
      <div style={{ fontSize: ".85rem", opacity: 0.8 }}>Muse fragt: Willst du das wirklich? ({a.action})</div>
      <div style={{ fontSize: "1.15rem", fontWeight: 600, margin: ".35rem 0" }}>{a.summary}</div>
      {a.details && Object.keys(a.details).length > 0 && (
        <details>
          <summary className="meta">Details</summary>
          <pre className="meta" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {JSON.stringify(a.details, null, 2)}
          </pre>
        </details>
      )}
      {ownerKey ? (
        <div style={{ display: "flex", gap: 12, marginTop: 10 }}>
          <button type="button" disabled={busy} onClick={() => onDecide(a, "approved")} style={bigBtn("#1f9d55")}>
            Ja
          </button>
          <button type="button" disabled={busy} onClick={() => onDecide(a, "denied")} style={bigBtn("#c53030")}>
            Nein
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (k.trim()) onUnlock(k.trim());
          }}
          style={{ marginTop: 8 }}
        >
          <label>Owner-Key (einmal pro Gerät, dann nur noch Ja/Nein)</label>
          <input type="password" autoComplete="off" value={k} onChange={(e) => setK(e.target.value)} />
          <div className="row">
            <button type="submit">Entsperren</button>
          </div>
        </form>
      )}
    </div>
  );
}

function TaskThread({
  m,
  notes,
  ownerKey,
  busy,
  onReply,
  onUnlock,
}: {
  m: Msg;
  notes: Note[];
  ownerKey: string | null;
  busy: boolean;
  onReply: (m: Msg, text: string) => Promise<boolean>;
  onUnlock: (k: string) => void;
}) {
  const [t, setT] = useState("");
  const [k, setK] = useState("");
  const waiting = m.task_state === "waiting";
  if (notes.length === 0 && !waiting) return null;
  return (
    <div style={{ marginTop: 8, borderLeft: "3px solid #a89bff", paddingLeft: 10 }}>
      {notes.map((n) => (
        <div key={n.id} className="meta" style={{ whiteSpace: "pre-wrap", margin: ".25rem 0", fontWeight: n.kind === "question" ? 600 : 400 }}>
          {n.author === "owner" ? "Du" : n.kind === "question" ? "Muse fragt" : "Muse"}:{" "}
          {n.text}{" "}
          <span style={{ opacity: 0.6 }}>
            ({new Date(n.created_at).toLocaleString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })})
          </span>
        </div>
      ))}
      {ownerKey ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (t.trim() && (await onReply(m, t.trim()))) setT("");
          }}
          style={{ marginTop: 6 }}
        >
          <textarea
            rows={2}
            placeholder={waiting ? "Antwort an Muse…" : "Nachricht an Muse zu dieser Aufgabe…"}
            value={t}
            onChange={(e) => setT(e.target.value)}
          />
          <div className="row">
            <button type="submit" disabled={busy || !t.trim()}>
              Antworten
            </button>
          </div>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (k.trim()) onUnlock(k.trim());
          }}
          style={{ marginTop: 6 }}
        >
          <label>Owner-Key zum Antworten (einmal pro Gerät)</label>
          <input type="password" autoComplete="off" value={k} onChange={(e) => setK(e.target.value)} />
          <div className="row">
            <button type="submit">Entsperren</button>
          </div>
        </form>
      )}
    </div>
  );
}

function resultLabel(m: Msg): string {
  if (m.result_status === "draft") return "Entwurf (Muse kann noch ändern/zurückziehen)";
  if (m.result_status === "retracted") return "Von Muse zurückgezogen";
  if (m.result_status === "published") return m.read_at ? "Veröffentlicht · gelesen" : "Veröffentlicht";
  return "";
}

export default function Home() {
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [passcode, setPasscode] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [paused, setPaused] = useState(false);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [ownerKey, setOwnerKey] = useState<string | null>(null);
  const [view, setView] = useState<"heute" | "alle">("heute");
  const [notes, setNotes] = useState<Note[]>([]);
  const [summaries, setSummaries] = useState<Summary[]>([]);

  useEffect(() => {
    setOwnerKey(readOwnerKey());
  }, []);

  function unlockOwner(k: string) {
    try {
      localStorage.setItem(OWNER_STORE, k);
      sessionStorage.setItem(OWNER_STORE, k);
    } catch {
      /* ignore */
    }
    setOwnerKey(k);
  }

  function forgetOwner() {
    try {
      localStorage.removeItem(OWNER_STORE);
      sessionStorage.removeItem(OWNER_STORE);
    } catch {
      /* ignore */
    }
    setOwnerKey(null);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/session", { credentials: "include", cache: "no-store" });
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

  const load = useCallback(async () => {
    const res = await fetch(`/api/messages?status=`, { credentials: "include" });
    if (res.status === 401) {
      setAuthed(false);
      return;
    }
    if (!res.ok) throw new Error("Laden fehlgeschlagen");
    const data = await res.json();
    const list: Msg[] = data.messages ?? [];
    setMessages(list);
    setPaused(data.paused === true);
    markPublishedRead(list);
    const ar = await fetch(`/api/approvals?status=`, { credentials: "include" });
    if (ar.ok) setApprovals((await ar.json()).approvals ?? []);
    const nr = await fetch(`/api/tasks/notes`, { credentials: "include", cache: "no-store" });
    if (nr.ok) setNotes((await nr.json()).notes ?? []);
    const sr = await fetch(`/api/projects/summaries`, { credentials: "include", cache: "no-store" });
    if (sr.ok) setSummaries((await sr.json()).summaries ?? []);
  }, []);

  async function reply(m: Msg, text: string): Promise<boolean> {
    if (!ownerKey) return false;
    setBusy(true);
    try {
      const res = await fetch(`/api/tasks/${m.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-owner-key": ownerKey },
        body: JSON.stringify({ text }),
      });
      if (res.status === 403 || res.status === 401) {
        forgetOwner();
        setFlash({ kind: "err", text: "Owner-Key ungültig – bitte neu eingeben." });
        return false;
      }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setFlash({ kind: "err", text: d.error || "Antwort fehlgeschlagen." });
        return false;
      }
      setFlash({ kind: "ok", text: "Antwort gesendet – Muse macht beim nächsten Lauf weiter." });
      await load();
      return true;
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!authed) return;
    load().catch(() => setFlash({ kind: "err", text: "Nachrichten konnten nicht geladen werden." }));
    const t = setInterval(() => load().catch(() => {}), 10000);
    return () => clearInterval(t);
  }, [authed, load]);

  async function decide(a: Approval, decision: "approved" | "denied") {
    if (!ownerKey) return;
    setBusy(true);
    setFlash(null);
    try {
      const res = await fetch(`/api/approvals/${a.id}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-owner-key": ownerKey },
        body: JSON.stringify({ decision }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 403 || res.status === 401) {
        forgetOwner();
        setFlash({ kind: "err", text: "Owner-Key ungültig – bitte neu eingeben." });
        return;
      }
      if (!res.ok) {
        setFlash({ kind: "err", text: data.error || "Entscheidung fehlgeschlagen." });
        return;
      }
      const final = data.approval?.status ?? decision;
      // Tell Muse via the inbox (wakes its has_new heartbeat). Execution uses the ORIGINAL message_id.
      const note =
        final === "approved"
          ? `✅ Freigabe JA: ${a.summary}\napproval_id=${a.id}${a.message_id ? `\nmessage_id=${a.message_id}` : ""}\nBitte jetzt sofort ausführen (zapier_* mit message_id + approval_id), ohne Rückfrage im Chat.`
          : `❌ Freigabe NEIN: ${a.summary}\napproval_id=${a.id}${a.message_id ? `\nmessage_id=${a.message_id}` : ""}\nNicht ausführen.${data.approval?.decision_note ? ` (${data.approval.decision_note})` : ""}`;
      await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text: note, agent: "muse" }),
      }).catch(() => null);
      setFlash({
        kind: final === "approved" ? "ok" : "err",
        text: final === "approved" ? "Freigegeben – Muse führt es jetzt aus." : "Abgelehnt – Muse macht es nicht.",
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFlash(null);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ passcode, device_label: "web" }),
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

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setFlash(null);
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text, agent: "muse" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setFlash({ kind: "err", text: err.error || "Senden fehlgeschlagen." });
        return;
      }
      setText("");
      setFlash({ kind: "ok", text: "Aufgabe an Muse gesendet." });
      await load();
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
  }

  const openTasks = messages
    .filter((m) => m.status === "new" && (!m.agent || m.agent === "muse"))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const shown = view === "heute" ? openTasks : messages;

  return (
    <main>
      <div className="card">
        <h1>Muse Inbox</h1>
        <p className="sub">
          Schreibe Aufgaben für Meta Muse. Muse liest neue Nachrichten über die API / MCP und markiert sie als erledigt.{" "}
          <Link href="/chat" style={{ color: "#a89bff" }}>
            Zum Chat →
          </Link>{" "}
          ·{" "}
          <Link href="/pair" style={{ color: "#a89bff" }}>
            Gerät koppeln →
          </Link>
        </p>

        {checking ? (
          <p className="sub">Session wird geprüft…</p>
        ) : !authed ? (
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
        ) : (
          <>
            <form onSubmit={onSubmit}>
              <label htmlFor="task">Neue Aufgabe</label>
              <textarea
                id="task"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="z. B. Recherchiere X und fasse die Ergebnisse zusammen…"
                required
              />
              <LinkChips text={text} />
              <div className="row">
                <InsertLinkButton value={text} onChange={setText} />
                <button type="submit" disabled={busy || !text.trim()}>
                  An Muse senden
                </button>
                <button type="button" className="secondary" onClick={logout}>
                  Abmelden
                </button>
              </div>
            </form>
          </>
        )}

        {flash && <div className={`msg ${flash.kind}`}>{flash.text}</div>}
      </div>

      {authed && (
        <div className="list">
          <div style={{ display: "flex", gap: 8, marginBottom: ".75rem" }}>
            <button type="button" className={view === "heute" ? "" : "secondary"} onClick={() => setView("heute")}>
              Heute (offen: {openTasks.length})
            </button>
            <button type="button" className={view === "alle" ? "" : "secondary"} onClick={() => setView("alle")}>
              Verlauf
            </button>
            <Link href="/projekte" className="chat-link" style={{ alignSelf: "center" }}>
              📁 Projekte
            </Link>
          </div>
          {summaries.map((s) => (
            <SummaryCard key={s.activation_id} s={s} />
          ))}
          <h2 style={{ fontSize: "1.1rem", margin: "0 0 .75rem" }}>
            {view === "heute" ? "To-do für Muse (älteste zuerst)" : "Alle Nachrichten"}
          </h2>
          {paused && (
            <div className="msg err">
              Muse ist pausiert (Stopp-Wort STOPP). Fortsetzen nur mit Owner-Key unter{" "}
              <Link href="/approve" style={{ color: "#a89bff" }}>/approve</Link>.
            </div>
          )}
          {(() => {
            const ids = new Set(messages.map((m) => m.id));
            const loose = approvals.filter(
              (a) => a.status === "pending" && (!a.message_id || !ids.has(a.message_id))
            );
            const open = approvals.filter((a) => a.status === "pending").length;
            return (
              <>
                {open > 0 && (
                  <div className="msg" style={{ fontWeight: 600 }}>
                    {open} offene Freigabe{open === 1 ? "" : "n"} – bitte Ja oder Nein tippen.
                    {ownerKey && (
                      <button type="button" className="secondary" style={{ marginLeft: 8 }} onClick={forgetOwner}>
                        Owner-Key vergessen
                      </button>
                    )}
                  </div>
                )}
                {loose.map((a) => (
                  <div key={a.id} className="item">
                    <ApprovalCard a={a} ownerKey={ownerKey} busy={busy} onDecide={decide} onUnlock={unlockOwner} />
                  </div>
                ))}
              </>
            );
          })()}
          {view === "heute" && openTasks.length === 0 && (
            <p className="sub">Alles erledigt – keine offenen Aufgaben. Erledigte findest du im Verlauf.</p>
          )}
          {view === "alle" && messages.length === 0 && <p className="sub">Noch keine Nachrichten.</p>}
          {shown.map((m, i) => (
            <div key={m.id}>
            {view === "heute" && dayOf(m.created_at) !== (i > 0 ? dayOf(shown[i - 1].created_at) : "") && (
              <div className="meta" style={{ fontWeight: 600, margin: ".75rem 0 .25rem" }}>
                {dayOf(m.created_at) === dayOf(new Date().toISOString()) ? "Heute" : dayOf(m.created_at)}
              </div>
            )}
            <div key={m.id} className="item">
              <span className={`badge ${m.status === "done" ? "done" : ""}`}>
                {m.status === "done" ? "erledigt" : "neu"}
              </span>
              {m.agent && m.agent !== "muse" && (
                <span className="badge">{m.agent}</span>
              )}
              {m.status === "new" && m.task_state === "waiting" && (
                <span className="badge" style={{ background: "#b7791f", color: "#fff" }}>wartet auf Antwort</span>
              )}
              {m.source === "calendar" && <span className="badge">📅 Kalender</span>}
              {m.project_id && (
                <Link href={`/projekte/${m.project_id}`} className="badge" style={{ textDecoration: "none" }}>📁 Projekt</Link>
              )}
              {m.due_at && m.status === "new" && (
                <span className="badge">bis {new Date(m.due_at).toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" })}</span>
              )}
              <div style={{ whiteSpace: "pre-wrap" }}>{m.text}</div>
              <LinkChips text={m.text} />
              {resultLabel(m) && <span className="badge">{resultLabel(m)}</span>}
              {m.result && (
                <div className="meta" style={{ whiteSpace: "pre-wrap" }}>
                  Ergebnis: {m.result}
                </div>
              )}
              {m.result && <LinkChips text={m.result} />}
              <TaskThread
                m={m}
                notes={notes.filter((n) => n.message_id === m.id)}
                ownerKey={ownerKey}
                busy={busy}
                onReply={reply}
                onUnlock={unlockOwner}
              />
              {approvals
                .filter((a) => a.message_id === m.id)
                .map((a) => (
                  <ApprovalCard key={a.id} a={a} ownerKey={ownerKey} busy={busy} onDecide={decide} onUnlock={unlockOwner} />
                ))}
              {m.result_status === "draft" && (
                <button
                  type="button"
                  className="secondary"
                  onClick={async () => {
                    await fetch(`/api/messages/${m.id}/result/publish`, {
                      method: "POST",
                      credentials: "include",
                    });
                    await load();
                  }}
                >
                  Entwurf freigeben
                </button>
              )}
              <div className="meta">
                {new Date(m.created_at).toLocaleString("de-DE", {
                  timeZone: "Europe/Berlin",
                })}{" "}
                · {m.id.slice(0, 8)}…
              </div>
            </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
