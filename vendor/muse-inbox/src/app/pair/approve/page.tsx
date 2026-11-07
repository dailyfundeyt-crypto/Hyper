"use client";

import { FormEvent, Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

function ApproveInner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = useMemo(() => params.get("t")?.trim() || "", [params]);
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null
  );

  async function onApprove(e: FormEvent) {
    e.preventDefault();
    if (!token) {
      setFlash({ kind: "err", text: "Kein Pairing-Token in der URL." });
      return;
    }
    setBusy(true);
    setFlash(null);
    try {
      const res = await fetch("/api/pair/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          token,
          passcode,
          device_label: "phone",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFlash({
          kind: "err",
          text:
            data.error === "Falscher Zugangscode" || res.status === 401
              ? "Falscher Zugangscode."
              : data.error || "Freigabe fehlgeschlagen.",
        });
        return;
      }
      setFlash({ kind: "ok", text: "Gerät freigegeben. Weiter zum Chat…" });
      window.setTimeout(() => router.replace("/chat"), 700);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="pair-shell">
      <header className="pair-header">
        <div>
          <p className="chat-kicker">Helium Connect</p>
          <h1>Freigabe</h1>
          <p className="sub">
            Einmal Zugangscode eingeben und freigeben. Danach reicht die
            Session-Cookie (30 Tage).
          </p>
        </div>
        <Link href="/pair" className="chat-link">
          Desktop-QR
        </Link>
      </header>

      <div className="card pair-card">
        {!token ? (
          <div className="msg err">
            Ungültiger Link. Scanne den QR erneut auf dem Desktop unter /pair.
          </div>
        ) : (
          <form onSubmit={onApprove}>
            <label htmlFor="passcode">Zugangscode</label>
            <input
              id="passcode"
              type="password"
              autoComplete="current-password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder="API-Schlüssel / Passcode"
              required
              autoFocus
            />
            <p className="pair-hint" style={{ marginTop: "0.75rem" }}>
              Token: <code>{token.slice(0, 8)}…</code>
            </p>
            <div className="row">
              <button type="submit" disabled={busy || !passcode}>
                Freigeben &amp; öffnen
              </button>
            </div>
          </form>
        )}
        {flash && <div className={`msg ${flash.kind}`}>{flash.text}</div>}
      </div>
    </main>
  );
}

export default function ApprovePage() {
  return (
    <Suspense
      fallback={
        <main className="pair-shell">
          <p className="sub">Laden…</p>
        </main>
      }
    >
      <ApproveInner />
    </Suspense>
  );
}
