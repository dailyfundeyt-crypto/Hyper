"use client";

import { useEffect, useState } from "react";

export const OWNER_STORE = "muse_owner_key";
export function readOwnerKey(): string | null {
  try {
    return localStorage.getItem(OWNER_STORE) || sessionStorage.getItem(OWNER_STORE);
  } catch {
    return null;
  }
}
export function saveOwnerKey(k: string) {
  try {
    localStorage.setItem(OWNER_STORE, k);
  } catch {
    /* ignore */
  }
}

export type Activation = {
  activation_id: string;
  event_id: string;
  source: "calendar" | "always";
  active_on: string;
  due_at: string | null;
  summary_posted_at?: string | null;
  tasks?: { message_id: string; index: number; text: string; status: string; waiting_for_answer: boolean; result: string | null }[];
};
export type Project = {
  id: string;
  name: string;
  body: string;
  always_active: boolean;
  active_today: boolean;
  updated_at: string;
  url?: string;
  activations: Activation[];
  doc_tasks?: { index: number; text: string }[];
};

export const fmtDate = (d: string) =>
  new Date(d + (d.length === 10 ? "T12:00:00" : "")).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });

export function activationLabel(a: Activation): string {
  if (a.source === "always") return `immer aktiv · ${fmtDate(a.active_on)}`;
  return `📅 Kalender ${fmtDate(a.active_on)}${a.due_at ? ` · Termin ${fmtTime(a.due_at)}` : ""}`;
}

export function useSession() {
  const [state, setState] = useState<"checking" | "ok" | "no">("checking");
  useEffect(() => {
    fetch("/api/session", { credentials: "include", cache: "no-store" })
      .then((r) => setState(r.ok ? "ok" : "no"))
      .catch(() => setState("no"));
  }, []);
  return state;
}

export function OwnerKeyForm({ onSet }: { onSet: (k: string) => void }) {
  const [k, setK] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (k.trim()) {
          saveOwnerKey(k.trim());
          onSet(k.trim());
        }
      }}
      className="row"
    >
      <input type="password" value={k} onChange={(e) => setK(e.target.value)} placeholder="Owner-Key zum Bearbeiten" />
      <button type="submit">Entsperren</button>
    </form>
  );
}
