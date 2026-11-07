"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { InsertLinkButton, LinkChips, SummaryCard, type Summary } from "@/components/links-ui";
import { activationLabel, OwnerKeyForm, Project, readOwnerKey, useSession } from "@/components/project-ui";

export default function ProjektDoc() {
  const { id } = useParams<{ id: string }>();
  const session = useSession();
  const [p, setP] = useState<Project | null>(null);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [always, setAlways] = useState(false);
  const [ownerKey, setOwnerKey] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [summaries, setSummaries] = useState<Summary[]>([]);

  useEffect(() => setOwnerKey(readOwnerKey()), []);

  const load = useCallback(async () => {
    const r = await fetch(`/api/projects/${id}`, { credentials: "include", cache: "no-store" });
    if (!r.ok) {
      setFlash({ kind: "err", text: r.status === 404 ? "Dokument nicht gefunden." : "Laden fehlgeschlagen." });
      return;
    }
    const proj: Project = (await r.json()).project;
    setP(proj);
    setName(proj.name);
    setBody(proj.body);
    setAlways(proj.always_active);
    const sr = await fetch(`/api/projects/summaries`, { credentials: "include", cache: "no-store" });
    if (sr.ok) setSummaries(((await sr.json()).summaries ?? []).filter((s: Summary) => s.project_id === proj.id));
  }, [id]);

  useEffect(() => {
    if (session === "ok") load();
  }, [session, load]);

  async function save(nextAlways = always) {
    if (!ownerKey || !p) return;
    setBusy(true);
    setFlash(null);
    try {
      const r = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-owner-key": ownerKey },
        body: JSON.stringify({ id: p.id, name, body, always_active: nextAlways }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setFlash({ kind: "err", text: r.status === 403 ? "Owner-Key ungültig." : d.error || "Speichern fehlgeschlagen." });
        return;
      }
      setFlash({ kind: "ok", text: "Gespeichert." });
      await load();
    } finally {
      setBusy(false);
    }
  }

  const shareUrl = typeof window !== "undefined" && p ? `${window.location.origin}/projekte/${p.id}` : "";

  return (
    <main>
      <div className="card">
        <p className="sub">
          <Link href="/projekte" style={{ color: "#a89bff" }}>← Projekte</Link> ·{" "}
          <Link href="/" style={{ color: "#a89bff" }}>Inbox</Link>
        </p>
        {session === "no" && (
          <p className="sub">
            Bitte zuerst in der <Link href="/" style={{ color: "#a89bff" }}>Inbox</Link> anmelden.
          </p>
        )}
        {p && (
          <>
            <label htmlFor="pname">Name</label>
            <input id="pname" value={name} onChange={(e) => setName(e.target.value)} disabled={!ownerKey} />
            <label htmlFor="pbody">Inhalt (Aufgaben als Liste: „- …“ oder „1. …“; „- [x]“ = erledigt/übersprungen)</label>
            <textarea id="pbody" value={body} onChange={(e) => setBody(e.target.value)} rows={12} disabled={!ownerKey} />
            <LinkChips text={body} />
            <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
              <input
                type="checkbox"
                checked={always}
                disabled={!ownerKey || busy}
                onChange={(e) => {
                  setAlways(e.target.checked);
                  save(e.target.checked);
                }}
                style={{ width: "auto" }}
              />
              immer aktiv (läuft auch ohne Kalendertermin, jeden Tag)
            </label>
            {ownerKey ? (
              <div className="row">
                <InsertLinkButton value={body} onChange={setBody} />
                <button type="button" disabled={busy || !name.trim()} onClick={() => save()}>
                  Speichern
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => navigator.clipboard?.writeText(shareUrl).then(() => setFlash({ kind: "ok", text: "Link kopiert – in den Kalendertermin einfügen." }))}
                >
                  Inbox-Link kopieren
                </button>
              </div>
            ) : (
              <OwnerKeyForm onSet={setOwnerKey} />
            )}
            <p className="meta">Inbox-Link für den Kalender: {shareUrl}</p>
          </>
        )}
        {flash && <div className={`msg ${flash.kind}`}>{flash.text}</div>}
      </div>

      {p && (
        <div className="list">
          {summaries.map((s) => (
            <SummaryCard key={s.activation_id} s={s} />
          ))}
          <h2 style={{ fontSize: "1.1rem", margin: "0 0 .75rem" }}>
            Status: {p.active_today ? "heute aktiv" : "inaktiv"} {p.always_active && "· immer aktiv"}
          </h2>
          {p.activations.length === 0 && <p className="sub">Noch nie aktiviert. Ohne Kalendertermin (oder „immer aktiv“) macht Muse nichts.</p>}
          {p.activations.map((a) => (
            <div key={a.activation_id} className="item">
              <div style={{ fontWeight: 600 }}>Aktiviert durch: {activationLabel(a)}</div>
              {a.summary_posted_at && <span className="badge done">Zusammenfassung gepostet</span>}
              <ul>
                {(a.tasks ?? []).map((t) => (
                  <li key={t.message_id}>
                    <span className={`badge ${t.status === "done" ? "done" : ""}`}>{t.status === "done" ? "erledigt" : "offen"}</span>
                    {t.waiting_for_answer && <span className="badge" style={{ background: "#b7791f", color: "#fff" }}>wartet auf Antwort</span>}{" "}
                    {t.text.replace(/^📁[^\n]*\n/, "")}
                    {t.result && <div className="meta" style={{ whiteSpace: "pre-wrap" }}>Ergebnis: {t.result}</div>}
                    <LinkChips text={`${t.text}\n${t.result ?? ""}`} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
