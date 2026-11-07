"use client";

import { parseLinks, type LinkAttachment, type LinkKind } from "@/lib/links";

export const LINK_ICON: Record<LinkKind, string> = {
  drive_file: "📄",
  drive_folder: "📁",
  doc: "📝",
  sheet: "📊",
  slides: "📽️",
  web: "🔗",
};
const LINK_LABEL: Record<LinkKind, string> = {
  drive_file: "Drive-Datei",
  drive_folder: "Drive-Ordner",
  doc: "Doc",
  sheet: "Sheet",
  slides: "Slides",
  web: "Link",
};

function shortLabel(l: LinkAttachment): string {
  if (l.kind !== "web") return LINK_LABEL[l.kind] + (l.drive_id ? ` ${l.drive_id.slice(0, 6)}…` : "");
  try {
    const u = new URL(l.url);
    const path = u.pathname.length > 18 ? u.pathname.slice(0, 18) + "…" : u.pathname;
    return u.hostname.replace(/^www\./, "") + (path === "/" ? "" : path);
  } catch {
    return l.url.slice(0, 30);
  }
}

export function LinkChips({ text, links }: { text?: string | null; links?: LinkAttachment[] }) {
  const list = links ?? parseLinks(text);
  if (!list.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: ".35rem 0" }}>
      {list.map((l) => (
        <a
          key={l.url}
          href={l.url}
          target="_blank"
          rel="noopener noreferrer"
          title={l.url}
          style={{
            display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 10px", borderRadius: 999,
            background: "rgba(168,155,255,.15)", border: "1px solid rgba(168,155,255,.4)", color: "#c9c0ff",
            fontSize: ".85rem", textDecoration: "none", maxWidth: "100%", overflow: "hidden", whiteSpace: "nowrap",
          }}
        >
          <span aria-hidden>{LINK_ICON[l.kind]}</span>
          {shortLabel(l)}
        </a>
      ))}
    </div>
  );
}

/** "Link einfügen": asks for a URL and appends it on its own line. */
export function InsertLinkButton({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <button
      type="button"
      className="secondary"
      onClick={() => {
        const url = window.prompt("Link einfügen (Google Drive, Doc, Sheet, Slides oder beliebige URL):", "https://");
        if (!url || !/^https?:\/\/\S+$/i.test(url.trim())) return;
        const sep = value && !value.endsWith("\n") ? "\n" : "";
        onChange(value + sep + url.trim() + "\n");
      }}
    >
      🔗 Link einfügen
    </button>
  );
}

export type Summary = {
  project_id: string;
  project_name: string;
  activation_id: string;
  active_on: string;
  due_at: string | null;
  source?: string;
  url?: string;
  total: number;
  done: number;
  all_done: boolean;
  open?: { message_id: string; text: string }[];
  open_questions?: { message_id: string; text: string; question?: string | null }[];
  waiting_approvals?: { approval_id: string; summary: string; action: string }[];
  results?: { message_id: string; text: string; result: string | null }[];
  summary_posted_at?: string | null;
};

const fmt = (iso: string) => new Date(iso).toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" });
const strip = (t: string) => t.replace(/^📁[^\n]*\n/, "");

export function SummaryCard({ s }: { s: Summary }) {
  return (
    <div className="item" style={{ borderLeft: "4px solid #38a169" }}>
      <div style={{ fontWeight: 700, fontSize: "1.05rem" }}>✅ Bereit für deinen Termin: {s.project_name}</div>
      <div className="meta">
        {s.due_at ? `Termin ${fmt(s.due_at)}` : `Aktiv am ${s.active_on}`} · erledigt {s.done}/{s.total}
        {s.url && (
          <>
            {" · "}
            <a href={s.url.replace(/^https?:\/\/[^/]+/, "")} style={{ color: "#a89bff" }}>Dokument öffnen</a>
          </>
        )}
      </div>
      {!!s.waiting_approvals?.length && (
        <div style={{ marginTop: 6 }}>
          <b>Wartende Freigaben ({s.waiting_approvals.length})</b>
          <ul>{s.waiting_approvals.map((a) => <li key={a.approval_id}>{a.summary}</li>)}</ul>
        </div>
      )}
      {!!s.open_questions?.length && (
        <div style={{ marginTop: 6 }}>
          <b>Offene Fragen ({s.open_questions.length})</b>
          <ul>{s.open_questions.map((q) => <li key={q.message_id}>{q.question || strip(q.text)}</li>)}</ul>
        </div>
      )}
      {!!s.open?.length && (
        <div style={{ marginTop: 6 }}>
          <b>Noch offen ({s.open.length})</b>
          <ul>{s.open.map((q) => <li key={q.message_id}>{strip(q.text)}</li>)}</ul>
        </div>
      )}
      {!!s.results?.length && (
        <div style={{ marginTop: 6 }}>
          <b>Ergebnisse</b>
          <ul>
            {s.results.map((r) => (
              <li key={r.message_id}>
                {strip(r.text)}
                {r.result && <div className="meta" style={{ whiteSpace: "pre-wrap" }}>{r.result}</div>}
                <LinkChips text={`${r.result ?? ""}\n${r.text}`} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
