"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Approval = {
  id: string;
  created_at: string;
  message_id: string | null;
  action: string;
  summary: string;
  details: Record<string, unknown>;
  status: "pending" | "approved" | "denied";
  decided_at: string | null;
};

type TaskMsg = { id: string; text: string; result: string | null; result_status?: string | null };

type Grant = {
  id: string;
  action: string;
  description: string;
  scope: Record<string, unknown>;
  active: boolean;
  expires_at: string | null;
  revoked_at: string | null;
};

const STORE = "muse_owner_key";

function fmt(iso: string | null) {
  return iso
    ? new Date(iso).toLocaleString("de-DE", { timeZone: "Europe/Berlin" })
    : "—";
}

export default function ApprovePage() {
  const [ownerKey, setOwnerKey] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [items, setItems] = useState<Approval[]>([]);
  const [tasks, setTasks] = useState<Record<string, TaskMsg>>({});
  const [grants, setGrants] = useState<Grant[]>([]);
  const [paused, setPaused] = useState<boolean | null>(null);
  const [budget, setBudget] = useState<{ month: string; budget_eur: number; spent_eur: number; remaining_eur: number } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      const k = sessionStorage.getItem(STORE);
      if (k) setOwnerKey(k);
    } catch {
      /* ignore */
    }
  }, []);

  const load = useCallback(async (key: string) => {
    const h = { "x-owner-key": key };
    const [a, c, g, b] = await Promise.all([
      fetch("/api/approvals?status=pending", { headers: h, cache: "no-store" }),
      fetch("/api/control", { headers: h, cache: "no-store" }),
      fetch("/api/grants", { headers: h, cache: "no-store" }),
      fetch("/api/budget", { headers: h, cache: "no-store" }),
    ]);
    if (b.ok) setBudget(await b.json());
    if (a.status === 403 || a.status === 401) {
      setFlash("Owner-Key ungültig.");
      setOwnerKey(null);
      try {
        sessionStorage.removeItem(STORE);
      } catch {
        /* ignore */
      }
      return;
    }
    const list: Approval[] = (await a.json()).approvals ?? [];
    setItems(list);
    // Show the linked inbox task next to each request (session cookie, if paired)
    const ids = list.map((x) => x.message_id).filter(Boolean) as string[];
    if (ids.length) {
      const r = await fetch("/api/messages?status=", { credentials: "include", cache: "no-store" });
      if (r.ok) {
        const all: TaskMsg[] = (await r.json()).messages ?? [];
        setTasks(Object.fromEntries(all.map((m) => [m.id, m])));
      }
    }
    if (c.ok) setPaused((await c.json()).paused === true);
    if (g.ok) setGrants((await g.json()).grants ?? []);
  }, []);

  useEffect(() => {
    if (!ownerKey) return;
    load(ownerKey).catch(() => setFlash("Laden fehlgeschlagen."));
    const t = setInterval(() => load(ownerKey).catch(() => {}), 10000);
    return () => clearInterval(t);
  }, [ownerKey, load]);

  function onLogin(e: FormEvent) {
    e.preventDefault();
    const k = input.trim();
    if (!k) return;
    try {
      sessionStorage.setItem(STORE, k);
    } catch {
      /* ignore */
    }
    setInput("");
    setFlash(null);
    setOwnerKey(k);
  }

  async function decide(id: string, decision: "approved" | "denied") {
    if (!ownerKey) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/approvals/${id}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-owner-key": ownerKey },
        body: JSON.stringify({ decision }),
      });
      const data = await res.json().catch(() => ({}));
      setFlash(res.ok ? (decision === "approved" ? "Freigegeben." : "Abgelehnt.") : data.error || "Fehler");
      await load(ownerKey);
    } finally {
      setBusy(false);
    }
  }

  async function control(action: "stop" | "resume") {
    if (!ownerKey) return;
    setBusy(true);
    try {
      const res = await fetch("/api/control", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-owner-key": ownerKey },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setPaused(data.paused === true);
      else setFlash(data.error || "Fehler");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "12px" }}>
      <div className="card">
        <h1>Freigaben (Owner)</h1>
        <p className="sub">
          Nur du entscheidest. Muse kann hier nichts freigeben.{" "}
          <Link href="/" style={{ color: "#a89bff" }}>Inbox →</Link>
        </p>
        {!ownerKey ? (
          <form onSubmit={onLogin}>
            <label htmlFor="ok">Owner-Key</label>
            <input
              id="ok"
              type="password"
              autoComplete="off"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              required
            />
            <div className="row">
              <button type="submit">Entsperren</button>
            </div>
          </form>
        ) : (
          <div className="row">
            <span className={`badge ${paused ? "" : "done"}`}>
              {paused === null ? "…" : paused ? "Muse pausiert (STOPP)" : "Muse aktiv"}
            </span>
            {paused ? (
              <button type="button" disabled={busy} onClick={() => control("resume")}>
                Fortsetzen
              </button>
            ) : (
              <button type="button" className="secondary" disabled={busy} onClick={() => control("stop")}>
                STOPP
              </button>
            )}
            <button
              type="button"
              className="secondary"
              onClick={() => {
                try {
                  sessionStorage.removeItem(STORE);
                } catch {
                  /* ignore */
                }
                setOwnerKey(null);
              }}
            >
              Sperren
            </button>
          </div>
        )}
        {ownerKey && budget && (
          <div className="meta" style={{ fontSize: "1.05rem", marginTop: 10 }}>
            Budget {budget.month}: <b>{Number(budget.remaining_eur).toFixed(2)} €</b> übrig
            {" "}(ausgegeben {Number(budget.spent_eur).toFixed(2)} € von {Number(budget.budget_eur).toFixed(2)} €)
          </div>
        )}
        {flash && <div className="msg">{flash}</div>}
      </div>

      {ownerKey && (
        <div className="list">
          <h2 style={{ fontSize: "1.1rem", margin: "0 0 .75rem" }}>Offene Anfragen</h2>
          {items.length === 0 && <p className="sub">Keine offenen Anfragen.</p>}
          {items.map((a) => (
            <div key={a.id} className="item">
              <span className="badge">{a.action}</span>
              <div style={{ fontSize: "1.1rem", margin: ".4rem 0" }}>{a.summary}</div>
              {a.details && Object.keys(a.details).length > 0 && (
                <pre className="meta" style={{ whiteSpace: "pre-wrap" }}>
                  {JSON.stringify(a.details, null, 2)}
                </pre>
              )}
              <div className="meta">
                {fmt(a.created_at)} · {a.id.slice(0, 8)}…
              </div>
              {a.message_id && tasks[a.message_id] && (
                <div className="meta" style={{ whiteSpace: "pre-wrap", borderLeft: "3px solid #a89bff", paddingLeft: 8 }}>
                  Aufgabe: {tasks[a.message_id].text}
                </div>
              )}
              <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
                <button type="button" disabled={busy} onClick={() => decide(a.id, "approved")}
                  style={{ flex: 1, minHeight: 64, fontSize: "1.35rem", fontWeight: 700, borderRadius: 14 , background: "#1f9d55", color: "#fff"}}>
                  Ja
                </button>
                <button type="button" disabled={busy} onClick={() => decide(a.id, "denied")}
                  style={{ flex: 1, minHeight: 64, fontSize: "1.35rem", fontWeight: 700, borderRadius: 14 , background: "#c53030", color: "#fff"}}>
                  Nein
                </button>
              </div>
            </div>
          ))}

          <h2 style={{ fontSize: "1.1rem", margin: "1.5rem 0 .75rem" }}>Dauerfreigaben</h2>
          {grants.length === 0 && <p className="sub">Keine.</p>}
          {grants.map((g) => (
            <div key={g.id} className="item">
              <span className={`badge ${g.active && !g.revoked_at ? "done" : ""}`}>
                {g.active && !g.revoked_at ? "aktiv" : "widerrufen"}
              </span>
              <span className="badge">{g.action}</span>
              <div>{g.description}</div>
              <div className="meta">läuft ab: {fmt(g.expires_at)}</div>
              {g.active && !g.revoked_at && (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={async () => {
                    await fetch("/api/grants", {
                      method: "POST",
                      headers: { "Content-Type": "application/json", "x-owner-key": ownerKey },
                      body: JSON.stringify({ revoke: g.id }),
                    });
                    await load(ownerKey);
                  }}
                >
                  Widerrufen
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
