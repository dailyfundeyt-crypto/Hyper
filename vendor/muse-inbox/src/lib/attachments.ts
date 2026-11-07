import { randomUUID } from "crypto";
import {
  ATTACHMENTS_BUCKET,
  MuseAttachment,
  MuseFile,
  SIGNED_URL_TTL_SEC,
  getSupabase,
} from "./supabase";
import { getExpectedApiKey } from "./auth";

export type StoredAttachment = Omit<MuseAttachment, "url">;

function sanitizeFilename(name: string): string {
  const base = (name || "file").replace(/[/\\?%*:|"<>]/g, "_").trim();
  return base.slice(0, 180) || "file";
}

function extFromMime(mime: string | null | undefined): string {
  if (!mime) return "";
  const map: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
    "text/plain": ".txt",
    "application/zip": ".zip",
    "video/mp4": ".mp4",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/webm": ".webm",
  };
  return map[mime] || "";
}

export function parseDataUrl(dataUrl: string): {
  mime: string;
  buffer: Buffer;
} | null {
  const m = dataUrl.match(/^data:([^;,]+)?(?:;[^,]*)?;base64,([\s\S]+)$/);
  if (!m) return null;
  const mime = m[1] || "application/octet-stream";
  try {
    return { mime, buffer: Buffer.from(m[2], "base64") };
  } catch {
    return null;
  }
}

export async function uploadBuffer(opts: {
  buffer: Buffer;
  filename: string;
  mime?: string | null;
  kind?: string;
  id?: string;
}): Promise<StoredAttachment> {
  const id = opts.id || randomUUID();
  const filename = sanitizeFilename(opts.filename);
  const mime = opts.mime || "application/octet-stream";
  const kind = opts.kind || guessKind(mime, filename);
  const path = `${id}/${filename}${filename.includes(".") ? "" : extFromMime(mime)}`;
  const finalPath = path.replace(/\/+/g, "/");

  const supabase = getSupabase();
  const { error } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .upload(finalPath, opts.buffer, {
      contentType: mime,
      upsert: true,
    });
  if (error) throw new Error(`storage upload failed: ${error.message}`);

  const registered = await registerFile({
    id,
    path: finalPath,
    filename: finalPath.split("/").pop() || filename,
    mime,
    size: opts.buffer.byteLength,
    kind,
  });

  return {
    id: registered.id,
    path: registered.path,
    filename: registered.filename,
    mime: registered.mime,
    size: registered.size,
    kind: registered.kind,
  };
}

export async function uploadFromUrl(
  url: string,
  filenameHint?: string,
  kindHint?: string
): Promise<StoredAttachment> {
  if (url.startsWith("data:")) {
    const parsed = parseDataUrl(url);
    if (!parsed) throw new Error("invalid data URL");
    const ext = extFromMime(parsed.mime) || "";
    return uploadBuffer({
      buffer: parsed.buffer,
      filename: filenameHint || `upload${ext}`,
      mime: parsed.mime,
      kind: kindHint,
    });
  }

  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`fetch attachment failed: ${res.status}`);
  const mime =
    res.headers.get("content-type")?.split(";")[0]?.trim() ||
    "application/octet-stream";
  const buf = Buffer.from(await res.arrayBuffer());
  let filename = filenameHint;
  if (!filename) {
    try {
      const u = new URL(url);
      filename = decodeURIComponent(u.pathname.split("/").pop() || "") || undefined;
    } catch {
      /* ignore */
    }
  }
  return uploadBuffer({
    buffer: buf,
    filename: filename || `upload${extFromMime(mime)}`,
    mime,
    kind: kindHint,
  });
}

export async function registerFile(opts: {
  id?: string;
  path: string;
  filename: string;
  mime?: string | null;
  size?: number | null;
  kind?: string;
}): Promise<MuseFile> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("muse_register_file", {
    p_key: getExpectedApiKey(),
    p_path: opts.path,
    p_filename: opts.filename,
    p_mime: opts.mime ?? null,
    p_size: opts.size ?? null,
    p_kind: opts.kind || "file",
    p_id: opts.id ?? null,
  });
  if (error) throw new Error(error.message);
  return data as MuseFile;
}

export async function getFile(id: string): Promise<MuseFile> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("muse_get_file", {
    p_key: getExpectedApiKey(),
    p_id: id,
  });
  if (error) throw new Error(error.message);
  return data as MuseFile;
}

export async function createSignedUrl(
  path: string,
  ttlSec = SIGNED_URL_TTL_SEC
): Promise<string | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUrl(path, ttlSec);
  if (error || !data?.signedUrl) {
    console.error("signed url failed", path, error?.message);
    return null;
  }
  return data.signedUrl;
}

export async function createSignedUploadUrl(opts: {
  filename: string;
  mime?: string | null;
  kind?: string;
}): Promise<{
  file: MuseFile;
  uploadUrl: string;
  token: string;
  path: string;
}> {
  const id = randomUUID();
  const filename = sanitizeFilename(opts.filename);
  const mime = opts.mime || "application/octet-stream";
  const kind = opts.kind || guessKind(mime, filename);
  const path = `${id}/${filename}`;

  const supabase = getSupabase();
  const { data, error } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) {
    throw new Error(`signed upload url failed: ${error?.message || "unknown"}`);
  }

  const file = await registerFile({
    id,
    path,
    filename,
    mime,
    size: null,
    kind,
  });

  return {
    file,
    uploadUrl: data.signedUrl,
    token: data.token,
    path,
  };
}

export async function enrichAttachments(
  attachments: MuseAttachment[] | null | undefined
): Promise<MuseAttachment[]> {
  const list = Array.isArray(attachments) ? attachments : [];
  const out: MuseAttachment[] = [];
  for (const a of list) {
    if (!a?.path) continue;
    const url = await createSignedUrl(a.path);
    out.push({ ...a, url: url || undefined });
  }
  return out;
}

export function guessKind(mime: string | null | undefined, filename?: string): string {
  const m = (mime || "").toLowerCase();
  const f = (filename || "").toLowerCase();
  if (m.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg|bmp|heic)$/.test(f))
    return "image";
  if (m.startsWith("video/") || /\.(mp4|webm|mov|mkv|avi)$/.test(f)) return "video";
  if (m.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|flac|webm)$/.test(f))
    return "audio";
  if (m === "application/pdf" || f.endsWith(".pdf")) return "pdf";
  if (
    m.includes("zip") ||
    m.includes("compressed") ||
    /\.(zip|tar|gz|tgz|rar|7z)$/.test(f)
  )
    return "archive";
  if (
    m.startsWith("text/") ||
    /\.(ts|tsx|js|jsx|py|go|rs|java|c|cpp|h|md|json|yml|yaml|toml|css|html|sh)$/.test(
      f
    )
  )
    return "code";
  return "file";
}

export function attachmentRef(a: StoredAttachment): MuseAttachment {
  return {
    id: a.id,
    path: a.path,
    filename: a.filename,
    mime: a.mime,
    size: a.size,
    kind: a.kind,
  };
}
