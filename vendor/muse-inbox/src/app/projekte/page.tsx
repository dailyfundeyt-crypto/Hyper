"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { LinkChips } from "@/components/links-ui";
import { activationLabel, OwnerKeyForm, Project, readOwnerKey, useSession } from "@/components/project-ui";

function tomorrowLabel(): string {
  const d = new Date(Date.now() + 86400_000);
  return d.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function ProjektePage() {
  const session = useSession();
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [ownerKey, setOwnerKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setOwnerKey(readOwnerKey()), []);

  const load = useCallback(async () => {
    const r = await fetch("/api/projects", { credentials: "include", cache: "no-store" });
    if (r.ok) setProjects((await r.json()).projects ?? []);
    else setErr("Projekte konnten nicht geladen werden.");
  }, []);

  useEffect(() => {
    if (session === "ok") load();
  }, [session, load]);

  async function create(name: string, body: string) {
    if (!ownerKey) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-owner-key": ownerKey },
        body: JSON.stringify({ name, body, always_active: false }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(d.error || "Anlegen fehlgeschlagen.");
        return;
      }
      router.push(`/projekte/${d.project.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <div className="card">
        <h1>Projekte</h1>
        <p className="sub">
          Dokumente mit Aufgaben für Muse. Ein Dokument wird aktiv, wenn ein Kalendertermin es nennt (oder mit „immer aktiv“).{" "}
          <Link href="/" style={{ color: "#a89bff" }}>← Inbox</Link>
        </p>
        {session === "checking" && <p className="sub">Session wird geprüft…</p>}
        {session === "no" && (
          <p className="sub">
            Bitte zuerst in der <Link href="/" style={{ color: "#a89bff" }}>Inbox</Link> anmelden.
          </p>
        )}
        {session === "ok" &&
          (ownerKey ? (
            <div className="row">
              <button type="button" disabled={busy} onClick={() => create(`Dusty: Plan für ${tomorrowLabel()}`, "Ziel:\n\n- \n")}>
                ➕ Neues Dokument für morgen
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => {
                  const n = window.prompt("Name des Dokuments:", "Dusty: ");
                  if (n && n.trim()) create(n.trim(), "- \n");
                }}
              >
                Neues Dokument
              </button>
            </div>
          ) : (
            <OwnerKeyForm onSet={setOwnerKey} />
          ))}
        {err && <div className="msg err">{err}</div>}
      </div>

      {session === "ok" && (
        <div className="list">
          {projects.length === 0 && <p className="sub">Noch keine Dokumente.</p>}
          {projects.map((p) => (
            <div key={p.id} className="item">
              <Link href={`/projekte/${p.id}`} style={{ fontWeight: 700, color: "inherit" }}>
                {p.name}
              </Link>{" "}
              {p.always_active && <span className="badge">immer aktiv</span>}
              {p.active_today ? <span className="badge done">heute aktiv</span> : <span className="badge">inaktiv</span>}
              {p.activations.slice(0, 3).map((a) => (
                <div key={a.activation_id} className="meta">
                  Aktiviert: {activationLabel(a)}
                </div>
              ))}
              <LinkChips text={p.body} />
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
