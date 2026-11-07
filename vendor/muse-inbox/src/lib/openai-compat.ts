import { randomUUID } from "crypto";
import {
  attachmentRef,
  getFile,
  guessKind,
  uploadBuffer,
  uploadFromUrl,
  type StoredAttachment,
} from "./attachments";
import type { MuseAttachment } from "./supabase";

export type ChatMessage = {
  role?: string;
  content?: unknown;
  name?: string;
};

export type ParsedChatInput = {
  userText: string;
  contextText: string;
  storedText: string;
  attachments: MuseAttachment[];
};

function partText(p: Record<string, unknown>): string {
  if (typeof p.text === "string") return p.text;
  if (typeof p.content === "string") return p.content;
  return "";
}

async function collectPartAttachment(
  p: Record<string, unknown>
): Promise<StoredAttachment | null> {
  const type = String(p.type || "");

  if (type === "image_url") {
    const imageUrl = p.image_url;
    let url: string | null = null;
    if (typeof imageUrl === "string") url = imageUrl;
    else if (imageUrl && typeof imageUrl === "object") {
      const u = (imageUrl as { url?: unknown }).url;
      if (typeof u === "string") url = u;
    }
    if (!url) return null;
    return uploadFromUrl(url, undefined, "image");
  }

  if (type === "input_audio" || type === "audio") {
    const audio = (p.input_audio || p.audio) as
      | { data?: string; format?: string }
      | undefined;
    if (audio?.data) {
      const format = audio.format || "wav";
      const mime = format.includes("/") ? format : `audio/${format}`;
      const buf = Buffer.from(audio.data, "base64");
      return uploadBuffer({
        buffer: buf,
        filename: `audio.${format.includes("/") ? format.split("/")[1] : format}`,
        mime,
        kind: "audio",
      });
    }
    return null;
  }

  if (type === "input_file" || type === "file" || type === "file_url") {
    const fileObj = (p.file || p.input_file || {}) as Record<string, unknown>;
    const filename =
      (typeof p.filename === "string" && p.filename) ||
      (typeof fileObj.filename === "string" && fileObj.filename) ||
      (typeof fileObj.name === "string" && fileObj.name) ||
      "file";

    const fileId =
      (typeof p.file_id === "string" && p.file_id) ||
      (typeof fileObj.file_id === "string" && fileObj.file_id) ||
      (typeof fileObj.id === "string" && fileObj.id);
    if (fileId) {
      const existing = await getFile(fileId);
      return {
        id: existing.id,
        path: existing.path,
        filename: existing.filename,
        mime: existing.mime,
        size: existing.size,
        kind: existing.kind,
      };
    }

    const fileData =
      (typeof p.file_data === "string" && p.file_data) ||
      (typeof fileObj.file_data === "string" && fileObj.file_data) ||
      (typeof fileObj.data === "string" && fileObj.data);
    if (fileData) {
      if (fileData.startsWith("data:")) {
        return uploadFromUrl(fileData, filename);
      }
      const mime =
        (typeof p.mime === "string" && p.mime) ||
        (typeof fileObj.mime === "string" && fileObj.mime) ||
        (guessKind(null, filename) === "pdf"
          ? "application/pdf"
          : "application/octet-stream");
      return uploadBuffer({
        buffer: Buffer.from(fileData, "base64"),
        filename,
        mime,
      });
    }

    const fileUrl =
      (typeof p.file_url === "string" && p.file_url) ||
      (typeof fileObj.file_url === "string" && fileObj.file_url) ||
      (typeof fileObj.url === "string" && fileObj.url) ||
      (typeof p.url === "string" && p.url);
    if (fileUrl) {
      return uploadFromUrl(fileUrl, filename);
    }
  }

  return null;
}

function formatTurn(role: string, text: string): string {
  const label =
    role === "assistant" ? "Assistent" : role === "system" ? "System" : "User";
  return `${label}: ${text}`;
}

function contentToPlainText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const raw of content) {
    if (typeof raw === "string") {
      parts.push(raw);
      continue;
    }
    if (!raw || typeof raw !== "object") continue;
    const p = raw as Record<string, unknown>;
    if (p.type === "text" || typeof p.text === "string") {
      const t = partText(p);
      if (t) parts.push(t);
    }
  }
  return parts.join("\n");
}

export async function parseChatMessages(
  messages: ChatMessage[]
): Promise<ParsedChatInput> {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("messages required");
  }

  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if ((messages[i]?.role || "").toLowerCase() === "user") {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx < 0) throw new Error("last user message required");

  const prior = messages.slice(0, lastUserIdx);
  const contextLines: string[] = [];
  for (const m of prior) {
    const role = (m.role || "user").toLowerCase();
    const text = contentToPlainText(m.content).trim();
    if (!text) continue;
    contextLines.push(formatTurn(role, text));
  }
  const contextText = contextLines.join("\n\n");

  const last = messages[lastUserIdx];
  const content = last.content;
  const attachments: MuseAttachment[] = [];
  let userText = "";

  if (typeof content === "string") {
    userText = content;
  } else if (Array.isArray(content)) {
    const textParts: string[] = [];
    for (const raw of content) {
      if (typeof raw === "string") {
        textParts.push(raw);
        continue;
      }
      if (!raw || typeof raw !== "object") continue;
      const p = raw as Record<string, unknown>;
      const type = String(p.type || "");
      if (type === "text" || (!type && typeof p.text === "string")) {
        const t = partText(p);
        if (t) textParts.push(t);
        continue;
      }
      try {
        const att = await collectPartAttachment(p);
        if (att) attachments.push(attachmentRef(att));
      } catch (e) {
        console.error("attachment part failed", e);
        textParts.push(
          `[Anhang fehlgeschlagen: ${e instanceof Error ? e.message : "error"}]`
        );
      }
    }
    userText = textParts.join("\n").trim();
  } else if (content != null) {
    userText = String(content);
  }

  if (!userText.trim() && attachments.length === 0) {
    throw new Error("user message text or attachment required");
  }
  if (!userText.trim()) {
    userText = `(Anhang: ${attachments.map((a) => a.filename).join(", ")})`;
  }

  const storedText = contextText
    ? `--- Kontext ---\n${contextText}\n\n--- Neue Nachricht ---\n${userText}`
    : userText;

  return { userText, contextText, storedText, attachments };
}

export function chatCompletionId(): string {
  return `chatcmpl_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

export function buildChatCompletion(opts: {
  id?: string;
  content: string;
  model?: string;
  created?: number;
}): Record<string, unknown> {
  const id = opts.id || chatCompletionId();
  const created = opts.created ?? Math.floor(Date.now() / 1000);
  const model = opts.model || "muse";
  return {
    id,
    object: "chat.completion",
    created,
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: opts.content },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

export function queuedReply(messageId: string): string {
  return `Auftrag angenommen (id ${messageId}). Muse antwortet, sobald es die Inbox abholt.`;
}

export function sseChunk(opts: {
  id: string;
  created: number;
  model: string;
  content?: string;
  finish?: boolean;
}): string {
  const payload: Record<string, unknown> = {
    id: opts.id,
    object: "chat.completion.chunk",
    created: opts.created,
    model: opts.model,
    choices: [
      {
        index: 0,
        delta: opts.finish
          ? {}
          : opts.content !== undefined
            ? { content: opts.content }
            : { role: "assistant", content: "" },
        finish_reason: opts.finish ? "stop" : null,
      },
    ],
  };
  if (opts.finish) {
    payload.usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  }
  return `data: ${JSON.stringify(payload)}\n\n`;
}
