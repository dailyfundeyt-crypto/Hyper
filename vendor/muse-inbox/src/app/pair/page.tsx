"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";

type PairState =
  | { phase: "loading" }
  | { phase: "pending"; token: string; approveUrl: string; expiresAt: string; qrDataUrl: string }
  | { phase: "approved" }
  | { phase: "expired" }
  | { phase: "error"; message: string };

function remainingLabel(expiresAt: string) {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "abgelaufen";
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export default function PairPage() {
  const [state, setState] = useState<PairState>({ phase: "loading" });
  const [clock, setClock] = useState(0);
  const creating = useRef(false);

  const startPairing = useCallback(async () => {
    if (creating.current) return;
    creating.current = true;
    setState({ phase: "loading" });
    try {
      const res = await fetch("/api/pair/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_label: "desktop" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Pairing fehlgeschlagen");
      const qrDataUrl = await QRCode.toDataURL(data.approve_url, {
        width: 280,
        margin: 2,
        color: { dark: "#e8eaed", light: "#0c0e12" },
      });
      setState({
        phase: "pending",
        token: data.token,
        approveUrl: data.approve_url,
        expiresAt: data.expires_at,
        qrDataUrl,
      });
    } catch (e) {
      setState({
        phase: "error",
        message: e instanceof Error ? e.message : "Fehler",
      });
    } finally {
      creating.current = false;
    }
  }, []);

  useEffect(() => {
    startPairing();
  }, [startPairing]);

  useEffect(() => {
    if (state.phase !== "pending") return;
    const id = window.setInterval(() => setClock((c) => c + 1), 1000);
    return () => window.clearInterval(id);
  }, [state.phase]);

  useEffect(() => {
    if (state.phase !== "pending") return;
    const token = state.token;
    const expiresAt = state.expiresAt;

    const poll = async () => {
      if (new Date(expiresAt).getTime() <= Date.now()) {
        setState({ phase: "expired" });
        return;
      }
      try {
        const res = await fetch(`/api/pair/status?t=${encodeURIComponent(token)}`, {
          cache: "no-store",
          credentials: "include",
        });
        if (res.status === 404) return;
        const data = await res.json();
        if (data.status === "approved") {
          setState({ phase: "approved" });
          window.setTimeout(() => {
            window.location.href = "/chat";
          }, 900);
        } else if (data.status === "expired") {
          setState({ phase: "expired" });
        }
      } catch {
        /* ignore transient */
      }
    };

    poll();
    const id = window.setInterval(poll, 2000);
    return () => window.clearInterval(id);
  }, [state]);

  void clock;

  return (
    <main className="pair-shell">
      <header className="pair-header">
        <div>
          <p className="chat-kicker">Helium Connect</p>
          <h1>Gerät koppeln</h1>
          <p className="sub">
            Scanne den QR-Code mit dem Handy. Nach Freigabe erhältst du eine
            30-Tage-Session — ohne Zugangscode erneut einzugeben.
          </p>
        </div>
        <div className="chat-header-actions">
          <Link href="/chat" className="chat-link">
            Chat
          </Link>
          <Link href="/" className="chat-link">
            Inbox
          </Link>
        </div>
      </header>

      <div className="card pair-card">
        {state.phase === "loading" && (
          <p className="sub" style={{ margin: 0 }}>
            QR-Code wird erzeugt…
          </p>
        )}

        {state.phase === "pending" && (
          <>
            <div className="pair-qr-wrap">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={state.qrDataUrl} alt="Pairing QR-Code" className="pair-qr" />
            </div>
            <div className="pair-meta">
              <span className="dot pulse" />
              Warte auf Freigabe · noch {remainingLabel(state.expiresAt)}
            </div>
            <p className="pair-hint">
              Link:{" "}
              <a href={state.approveUrl} className="pair-url">
                {state.approveUrl}
              </a>
            </p>
            <div className="row">
              <button type="button" className="secondary" onClick={startPairing}>
                Neuen Code erzeugen
              </button>
            </div>
          </>
        )}

        {state.phase === "approved" && (
          <div className="msg ok">Gekoppelt. Weiterleitung zum Chat…</div>
        )}

        {state.phase === "expired" && (
          <>
            <div className="msg err">Dieser QR-Code ist abgelaufen (5 Minuten).</div>
            <div className="row">
              <button type="button" onClick={startPairing}>
                Neuen QR erzeugen
              </button>
            </div>
          </>
        )}

        {state.phase === "error" && (
          <>
            <div className="msg err">{state.message}</div>
            <div className="row">
              <button type="button" onClick={startPairing}>
                Erneut versuchen
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
