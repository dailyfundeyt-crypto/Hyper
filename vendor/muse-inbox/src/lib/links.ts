// Parse links in owner orders (Aufträge) into structured link attachments.
export type LinkKind = "drive_file" | "drive_folder" | "doc" | "sheet" | "slides" | "web";
export type LinkAttachment = { type: "link"; url: string; kind: LinkKind; drive_id?: string };

const URL_RE = /https?:\/\/[^\s<>"'`)\]]+/gi;
const ID = "([A-Za-z0-9_-]{10,})";

export function classifyLink(raw: string): LinkAttachment {
  const url = raw.replace(/[.,;:!?]+$/, "");
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch { /* keep web */ }
  const m = (re: RegExp) => url.match(re)?.[1];
  if (host === "docs.google.com") {
    const d = m(new RegExp(`/document/(?:u/\\d+/)?d/${ID}`));
    if (d) return { type: "link", url, kind: "doc", drive_id: d };
    const s = m(new RegExp(`/spreadsheets/(?:u/\\d+/)?d/${ID}`));
    if (s) return { type: "link", url, kind: "sheet", drive_id: s };
    const p = m(new RegExp(`/presentation/(?:u/\\d+/)?d/${ID}`));
    if (p) return { type: "link", url, kind: "slides", drive_id: p };
    const f = m(new RegExp(`/(?:file|forms)/(?:u/\\d+/)?d/${ID}`)) ?? m(new RegExp(`[?&]id=${ID}`));
    if (f) return { type: "link", url, kind: "drive_file", drive_id: f };
  }
  if (host === "drive.google.com") {
    const folder = m(new RegExp(`/folders/${ID}`));
    if (folder) return { type: "link", url, kind: "drive_folder", drive_id: folder };
    const file = m(new RegExp(`/file/(?:u/\\d+/)?d/${ID}`)) ?? m(new RegExp(`[?&]id=${ID}`));
    if (file) return { type: "link", url, kind: "drive_file", drive_id: file };
    return { type: "link", url, kind: "drive_file" };
  }
  return { type: "link", url, kind: "web" };
}

export function parseLinks(text: string | null | undefined): LinkAttachment[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: LinkAttachment[] = [];
  for (const raw of text.match(URL_RE) ?? []) {
    const l = classifyLink(raw);
    if (seen.has(l.url)) continue;
    seen.add(l.url);
    out.push(l);
  }
  return out;
}
