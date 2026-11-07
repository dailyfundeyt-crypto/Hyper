import { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { requireBearerKey } from "@/lib/auth";
import {
  getTask,
  listMessages,
  markDone,
  hasNewMessages,
  submitDraft,
  editResult,
  retractResult,
  publishResult,
  getControl,
  requestApproval,
  getApproval,
  listApprovals,
  listGrants,
  getBudget,
  listOpenTasks,
  completeTask,
  postTaskNote,
  listTaskNotes,
  addCalendarTask,
} from "@/lib/messages";
import { activateProjectFromCalendar, getProject, listProjects, projectSummary } from "@/lib/projects";
import { ZAPIER_PREFIX, callZapierTool, listZapierTools, zapierEnabled } from "@/lib/zapier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type JsonRpcId = string | number | null;
type JsonRpcReq = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
};

const SERVER_INFO = { name: "muse-inbox", version: "0.2.0" };
const INSTRUCTIONS =
  "Muse Inbox MCP. Nur Stefans eigene Nachrichten; Antworten nur zurück in diese Inbox. " +
  "Antworten sind ENTWÜRFE (submit_draft/mark_done) und bleiben bis zum Lesen durch Stefan editierbar (edit_result) " +
  "und zurückziehbar (retract_result); publish_result gibt frei. Stopp-Wort: STOPP (get_control_state zeigt paused). " +
  "AUFTRÄGE AUS DER INBOX (Ordner/Dateien anlegen, löschen, verschieben, Kauf, Nachricht nach außen, alles über Zapier): " +
  "request_approval(message_id, action, summary, details) → Stefan tippt Ja/Nein direkt in der Inbox → get_approval pollen → " +
  "bei approved SOFORT ausführen über zapier_* mit message_id + approval_id, ohne Rückfrage im Chat. Bestätigungen immer über die Inbox, nie im Muse-Chat. " +
  "Lesen ist frei. TÄGLICHE AUFGABEN: Jede Owner-Nachricht ist eine Aufgabe. Bei jedem Heartbeat-Lauf: get_control_state (STOPP?) → " +
  "list_open_tasks → ALLE offenen Aufgaben der Reihe nach (älteste zuerst) abarbeiten und jede mit complete_task(message_id, result_note) abschließen. " +
  "Was nicht fertig wird, bleibt offen für den nächsten Lauf. GESPRÄCH PRO AUFGABE: post_update (Zwischenstand), ask_owner (Frage → Aufgabe 'wartet auf Antwort'), " +
  "get_owner_replies (Stefans Antworten lesen; eine Antwort öffnet die Aufgabe wieder → Flag A). LINKS: Aufträge/Dokumente können Links enthalten; sie stehen als attachments {url, kind drive_file|drive_folder|doc|sheet|slides|web, drive_id} in list_open_tasks/get_task/get_project. Drive-Elemente per drive_id mit den zapier_* Google-Drive/Docs/Sheets-Lese-Tools öffnen (Lesen frei; Ändern nur mit Freigabe). PROJEKT-DOKUMENTE + KALENDER: Bei deinem täglichen Kalender-Check (Uhrzeit stellt Stefan in Muse ein) die heutigen Termine über Zapier Google Calendar lesen. Nennt Titel/Beschreibung ein Projekt-Dokument (exakt oder ungefähr, z.B. 'Dusty: Projekt Auftrag 1') oder enthält einen Inbox-Link /projekte/<id> → activate_project_from_calendar(event_id, project_name_or_id, due_at=Terminbeginn). matched=false → add_task_from_calendar(event_id, title, due_at, prompt) mit dem Termintext. Terminbeginn = Deadline: alle Aufgaben vorher fertig machen, Freigaben/Rückfragen FRÜH stellen. Liegt der Beginn schon zurück oder in <15 Min (work_now=true) → sofort abarbeiten. Wenn alles erledigt ist bzw. zur Deadline: post_project_summary(project_id) → Karte 'Bereit für deinen Termin'. Nicht aktivierte Dokumente ohne 'immer aktiv' NICHT bearbeiten (kein Termin = nichts tun). Kalender (ohne Dokument): add_task_from_calendar(event_id, title, due_at, prompt), dedupliziert per event_id. Auth via Bearer / x-api-key / ?key=.";

/** Newest first. Includes modern 2026-07-28 + legacy handshake versions. */
const SUPPORTED_PROTOCOL_VERSIONS = [
  "2026-07-28",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
] as const;
const LEGACY_DEFAULT = "2025-03-26";
const MODERN_VERSION = "2026-07-28";
const META_PROTOCOL = "io.modelcontextprotocol/protocolVersion";
const META_SERVER_INFO = "io.modelcontextprotocol/serverInfo";

const HEADER_MISMATCH = -32020;
const UNSUPPORTED_PROTOCOL_VERSION = -32022;

const TOOLS = [
  {
    name: "has_new",
    description:
      "Returns A if new inbox messages exist, else B",
    inputSchema: {
      type: "object" as const,
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "list_new_messages",
    description:
      "Listet neue (status=new) Aufgaben aus Stefans Muse Inbox. Ohne Argumente.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "mark_done",
    description:
      "Markiert eine Inbox-Nachricht als erledigt; das Ergebnis wird als ENTWURF gespeichert (wie submit_draft).",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "UUID der Nachricht" },
        result: {
          type: "string",
          description: "Ergebnis-/Antworttext von Muse",
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "submit_draft",
    description:
      "Speichert/aktualisiert Muses Antwort als ENTWURF (result_status=draft). Bis Stefan sie liest, editier- und zurückziehbar. Bei Pause (STOPP) abgelehnt.",
    inputSchema: {
      type: "object" as const,
      properties: {"id": {"type": "string", "description": "UUID der Nachricht"}, "result": {"type": "string", "description": "Antworttext"}},
      required: ["id", "result"],
      additionalProperties: false,
    },
  },
  {
    name: "edit_result",
    description:
      "Ändert eine Antwort, solange Stefan sie noch nicht gelesen hat (read_at leer). Zurückgezogene werden wieder Entwurf.",
    inputSchema: {
      type: "object" as const,
      properties: {"id": {"type": "string", "description": "UUID der Nachricht"}, "result": {"type": "string", "description": "Neuer Antworttext"}},
      required: ["id", "result"],
      additionalProperties: false,
    },
  },
  {
    name: "retract_result",
    description:
      "Zieht eine Antwort zurück (Entwurf oder veröffentlicht), solange sie ungelesen ist. Funktioniert auch bei Pause.",
    inputSchema: {
      type: "object" as const,
      properties: {"id": {"type": "string", "description": "UUID der Nachricht"}, "reason": {"type": "string", "description": "Optionaler Grund"}},
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "publish_result",
    description:
      "Gibt einen Entwurf frei (published). Erst nach dem Lesen durch Stefan ist er gesperrt.",
    inputSchema: {
      type: "object" as const,
      properties: {"id": {"type": "string", "description": "UUID der Nachricht"}},
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "get_control_state",
    description:
      "Kill-Switch-Status: {paused, updated_at, updated_by, stop_word}. paused=true heißt: sofort aufhören.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "request_approval",
    description:
      "Freigabe für einen Auftrag aus Stefans Inbox. IMMER message_id der Inbox-Nachricht mitgeben. Stefan bekommt in der Inbox eine Karte mit großen Ja/Nein-Knöpfen (nicht im Chat fragen!). Danach get_approval(id) pollen; bei status approved SOFORT das passende zapier_*-Tool mit message_id + approval_id aufrufen – keine weitere Bestätigung im Chat. Gilt für jede Schreib-/Ausführ-Aktion: Ordner/Dateien anlegen, löschen, verschieben, Kauf (action=purchase, details.amount_eur, item, link; über Restbudget = auto-abgelehnt), Nachricht nach außen (details: recipient, platform, text), eBay, Admin. Gesperrte IDs 0528/0548/0551/0553/0572/0626 und alte Store-5-IDs nur, wenn details sie ausdrücklich nennt. Eine Freigabe = ein Aufruf.",
    inputSchema: {
      type: "object" as const,
      properties: {"message_id": {"type": "string", "description": "UUID der Inbox-Nachricht mit Stefans Auftrag (Pflicht für Ausführung über Zapier)"}, "action": {"type": "string", "description": "z. B. google_drive.create_folder, google_drive.delete, google_drive.move, purchase, outbound_message"}, "summary": {"type": "string", "description": "Kurz und klar, was passiert (wird Stefan auf der Ja/Nein-Karte gezeigt)"}, "details": {"type": "object", "description": "Genaue Angaben: Tool, Ordner-/Datei-IDs, Namen, Ziel; bei Kauf amount_eur/item/link"}},
      required: ["action", "summary"],
      additionalProperties: false,
    },
  },
  {
    name: "get_approval",
    description:
      "Status einer Freigabe: pending (Stefan hat noch nicht getippt) | approved (Ja → jetzt sofort ausführen mit message_id + approval_id) | denied (Nein → nicht ausführen, im Ergebnis vermerken). used_at gesetzt = bereits verbraucht.",
    inputSchema: {
      type: "object" as const,
      properties: {"id": {"type": "string", "description": "UUID der Freigabe-Anfrage"}},
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "list_open_tasks",
    description:
      "Tägliche Aufgabenliste: alle noch nicht erledigten Owner-Nachrichten an Muse, älteste zuerst, nach Tag (Europe/Berlin) gruppiert. " +
      "Bei jedem Lauf: erst get_control_state (STOPP), dann ALLE Aufgaben der Reihe nach abarbeiten und jede mit complete_task abschließen. Unfertiges bleibt offen.",
    inputSchema: { type: "object" as const, properties: {}, additionalProperties: false },
  },
  {
    name: "complete_task",
    description:
      "Schließt eine Aufgabe (Owner-Nachricht) ab: status=done, result_note wird als Ergebnis (Entwurf) gespeichert. Danach verschwindet sie aus 'Heute', bleibt aber im Verlauf.",
    inputSchema: {
      type: "object" as const,
      properties: {
        message_id: { type: "string", description: "UUID der Aufgabe/Nachricht" },
        result_note: { type: "string", description: "Kurz, was erledigt wurde (oder warum nicht möglich)" },
      },
      required: ["message_id"],
      additionalProperties: false,
    },
  },
  {
    name: "post_update",
    description: "Zwischenstand zu einer Aufgabe in Stefans Inbox-Thread schreiben (erscheint unter der Aufgabe). Aufgabe bleibt offen.",
    inputSchema: {
      type: "object" as const,
      properties: { message_id: { type: "string" }, text: { type: "string" } },
      required: ["message_id", "text"],
      additionalProperties: false,
    },
  },
  {
    name: "ask_owner",
    description:
      "Rückfrage an Stefan zu einer Aufgabe (im Inbox-Thread, mit Antwortfeld). Aufgabe wird 'wartet auf Antwort' und bleibt offen; das Hook-Flag zeigt erst wieder A, wenn Stefan antwortet. " +
      "Für Freigaben von Schreib-/Löschaktionen stattdessen request_approval nutzen.",
    inputSchema: {
      type: "object" as const,
      properties: { message_id: { type: "string" }, question: { type: "string" } },
      required: ["message_id", "question"],
      additionalProperties: false,
    },
  },
  {
    name: "get_owner_replies",
    description:
      "Liest den Thread einer Aufgabe: Muse-Updates/Fragen und Stefans Antworten (author=owner, kind=reply), chronologisch. waiting_for_answer zeigt, ob noch eine Frage offen ist.",
    inputSchema: {
      type: "object" as const,
      properties: { message_id: { type: "string" } },
      required: ["message_id"],
      additionalProperties: false,
    },
  },
  {
    name: "get_task",
    description: "Eine Aufgabe (Inbox-Nachricht) inkl. attachments: Datei-Anhänge und erkannte Links {url, kind, drive_id}.",
    inputSchema: { type: "object" as const, properties: { message_id: { type: "string" } }, required: ["message_id"], additionalProperties: false },
  },
  {
    name: "list_projects",
    description: "Alle Projekt-Dokumente (Name, Inhalt, immer aktiv, active_today, Aktivierungen mit Kalenderdatum, url /projekte/<id>, Links als attachments).",
    inputSchema: { type: "object" as const, properties: {}, additionalProperties: false },
  },
  {
    name: "get_project",
    description:
      "Ein Projekt-Dokument per ID, Inbox-Link (/projekte/<id>) oder Name (auch ungefähr). Enthält body, doc_tasks, attachments (Links mit drive_id), " +
      "activations (Datum, due_at, Aufgaben mit message_id/Status/Ergebnis).",
    inputSchema: { type: "object" as const, properties: { project: { type: "string", description: "ID, Link oder Name" } }, required: ["project"], additionalProperties: false },
  },
  {
    name: "activate_project_from_calendar",
    description:
      "Beim täglichen Kalender-Check: aktiviert das im Termin genannte Projekt-Dokument für das Termindatum (dedupliziert per event_id) und legt seine Aufgaben als Inbox-Aufgaben an (erscheinen in list_open_tasks). " +
      "due_at = Terminbeginn = Deadline. Rückgabe {matched, activated, deduped, project{id,name,url}, activation_id, due_at, work_now, tasks[]}. matched=false → add_task_from_calendar mit dem Termintext. " +
      "work_now=true (Beginn vorbei oder <15 Min) → sofort abarbeiten.",
    inputSchema: {
      type: "object" as const,
      properties: {
        event_id: { type: "string", description: "Google-Calendar-Event-ID" },
        project_name_or_id: { type: "string", description: "Name (exakt/ungefähr), ID oder Inbox-Link /projekte/<id> aus Titel/Beschreibung" },
        due_at: { type: "string", description: "ISO-Zeitpunkt des Terminbeginns (Deadline)" },
      },
      required: ["event_id", "project_name_or_id"],
      additionalProperties: false,
    },
  },
  {
    name: "post_project_summary",
    description:
      "Erzeugt und speichert die Karte 'Bereit für deinen Termin' für die aktuelle Aktivierung eines Dokuments: erledigt, wartende Freigaben, offene Fragen, Ergebnisse mit Links. " +
      "Aufrufen, wenn alle Aufgaben erledigt sind oder spätestens zur Deadline (Terminbeginn). Die Inbox zeigt die Karte zur Deadline ohnehin automatisch.",
    inputSchema: {
      type: "object" as const,
      properties: { project_id: { type: "string", description: "ID, Link oder Name des Dokuments" }, activation_id: { type: "string", description: "optional, sonst neueste Aktivierung" } },
      required: ["project_id"],
      additionalProperties: false,
    },
  },
  {
    name: "add_task_from_calendar",
    description:
      "Legt aus einem Google-Kalender-Termin (Titel 'Dusty', verknüpftes Google Doc = Aufgabe) eine Aufgabe in der Inbox-Queue an. Dedupliziert per event_id (zweiter Aufruf legt nichts neu an). " +
      "prompt = Inhalt/Link des Google Docs. Rückgabe {created, message_id}.",
    inputSchema: {
      type: "object" as const,
      properties: {
        event_id: { type: "string", description: "Google-Calendar-Event-ID" },
        title: { type: "string" },
        due_at: { type: "string", description: "ISO-Zeitpunkt (Terminbeginn)" },
        prompt: { type: "string", description: "Aufgabentext aus dem verknüpften Google Doc (oder Doc-Link)" },
      },
      required: ["event_id", "title"],
      additionalProperties: false,
    },
  },
  {
    name: "list_approvals",
    description:
      "Listet Freigaben. status=approved zeigt, was Stefan mit Ja bestätigt hat; Einträge ohne used_at sind noch auszuführen (mit message_id + approval_id). status leer = alle.",
    inputSchema: {
      type: "object" as const,
      properties: {"status": {"type": "string", "description": "pending | approved | denied | leer (alle)"}},
      additionalProperties: false,
    },
  },
  {
    name: "get_budget",
    description:
      "Budget des Store-Mandats Dusty für den aktuellen Monat: {budget_eur, spent_eur, remaining_eur}. Käufe über dem Restbudget werden automatisch abgelehnt.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "get_grants",
    description:
      "Listet Stefans aktive Daueraufträge/Vorab-Freigaben (Aktion + Scope + Ablauf). Nur innerhalb dieses Scopes ohne request_approval handeln.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      additionalProperties: false,
    },
  },
];

function isSupportedVersion(v: string | null | undefined): v is string {
  return (
    !!v &&
    (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(v)
  );
}

function isModern(version: string): boolean {
  return version === MODERN_VERSION;
}

function rpcResult(id: JsonRpcId | undefined, result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcError(
  id: JsonRpcId | undefined,
  code: number,
  message: string,
  data?: unknown
) {
  const error: { code: number; message: string; data?: unknown } = {
    code,
    message,
  };
  if (data !== undefined) error.data = data;
  return { jsonrpc: "2.0", id: id ?? null, error };
}

function negotiateInitializeVersion(requested: unknown): string {
  if (typeof requested === "string" && isSupportedVersion(requested)) {
    return requested;
  }
  // Prefer newest legacy-handshake version when unknown (not modern-only)
  return "2025-06-18";
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, Accept, Mcp-Session-Id, MCP-Protocol-Version, Mcp-Method, Mcp-Name, X-Api-Key, Last-Event-ID",
    "Access-Control-Expose-Headers":
      "Mcp-Session-Id, MCP-Protocol-Version",
  };
}

function wantsSse(accept: string | null): boolean {
  if (!accept) return false;
  const parts = accept.split(",").map((p) => p.trim().toLowerCase());
  const hasSse = parts.some((p) => p.startsWith("text/event-stream"));
  const hasJson = parts.some((p) => p.startsWith("application/json"));
  if (hasSse && !hasJson) return true;
  if (!hasSse) return false;
  const sseQ = qValue(parts, "text/event-stream");
  const jsonQ = qValue(parts, "application/json");
  return sseQ > jsonQ;
}

function qValue(parts: string[], type: string): number {
  for (const p of parts) {
    if (!p.startsWith(type)) continue;
    const m = p.match(/;\s*q=([0-9.]+)/);
    return m ? Number(m[1]) : 1;
  }
  return 0;
}

function sessionIdFor(req: NextRequest, mint: boolean): string | undefined {
  const existing = req.headers.get("mcp-session-id");
  if (existing && /^[\x21-\x7E]+$/.test(existing)) return existing;
  if (mint) return randomUUID();
  return undefined;
}

function decodeMcpHeaderValue(raw: string | null): string | null {
  if (raw == null) return null;
  const m = raw.match(/^=\?base64\?(.+)\?=$/);
  if (m) {
    try {
      return Buffer.from(m[1], "base64").toString("utf8");
    } catch {
      return raw;
    }
  }
  return raw;
}

function jsonResponse(
  payload: unknown,
  opts: {
    status?: number;
    sessionId?: string;
    protocolVersion?: string;
  } = {}
) {
  const headers: Record<string, string> = {
    ...corsHeaders(),
    "Content-Type": "application/json",
  };
  if (opts.sessionId && opts.protocolVersion && !isModern(opts.protocolVersion)) {
    headers["Mcp-Session-Id"] = opts.sessionId;
  }
  if (opts.protocolVersion) {
    headers["MCP-Protocol-Version"] = opts.protocolVersion;
  }
  return new Response(JSON.stringify(payload), {
    status: opts.status ?? 200,
    headers,
  });
}

function sseResponse(
  payload: unknown,
  opts: {
    status?: number;
    sessionId?: string;
    protocolVersion?: string;
  } = {}
) {
  const data = JSON.stringify(payload);
  const body = `event: message\ndata: ${data}\n\n`;
  const headers: Record<string, string> = {
    ...corsHeaders(),
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  };
  if (opts.sessionId && opts.protocolVersion && !isModern(opts.protocolVersion)) {
    headers["Mcp-Session-Id"] = opts.sessionId;
  }
  if (opts.protocolVersion) {
    headers["MCP-Protocol-Version"] = opts.protocolVersion;
  }
  return new Response(body, { status: opts.status ?? 200, headers });
}

function respondRpc(
  req: NextRequest,
  payload: unknown,
  opts: { sessionId?: string; protocolVersion?: string; status?: number }
) {
  if (wantsSse(req.headers.get("accept"))) {
    return sseResponse(payload, opts);
  }
  return jsonResponse(payload, opts);
}

function modernResultMeta() {
  return { [META_SERVER_INFO]: SERVER_INFO };
}

function wrapModernResult(result: Record<string, unknown>) {
  return {
    resultType: "complete",
    ...result,
    _meta: {
      ...(typeof result._meta === "object" && result._meta
        ? (result._meta as Record<string, unknown>)
        : {}),
      ...modernResultMeta(),
    },
  };
}

function paramsMeta(params: Record<string, unknown>): Record<string, unknown> {
  const meta = params._meta;
  return meta && typeof meta === "object"
    ? (meta as Record<string, unknown>)
    : {};
}

function resolveProtocolVersion(
  req: NextRequest,
  msg: JsonRpcReq
): { version: string; error?: ReturnType<typeof rpcError>; httpStatus?: number } {
  const header = req.headers.get("mcp-protocol-version");
  const meta = paramsMeta((msg.params ?? {}) as Record<string, unknown>);
  const metaVersion =
    typeof meta[META_PROTOCOL] === "string"
      ? (meta[META_PROTOCOL] as string)
      : undefined;

  // initialize (legacy): negotiate from params.protocolVersion
  if (msg.method === "initialize") {
    const requested =
      typeof (msg.params as Record<string, unknown> | undefined)
        ?.protocolVersion === "string"
        ? ((msg.params as Record<string, unknown>).protocolVersion as string)
        : header ?? metaVersion;
    return { version: negotiateInitializeVersion(requested) };
  }

  // Prefer header; fall back to _meta; then legacy default when omitted
  // server/discover is the modern probe — treat as 2026-07-28 when version omitted
  let requested = header || metaVersion;
  if (!requested && msg.method === "server/discover") {
    requested = MODERN_VERSION;
  }

  if (header && metaVersion && header !== metaVersion) {
    return {
      version: header,
      httpStatus: 400,
      error: rpcError(
        msg.id,
        HEADER_MISMATCH,
        `Header mismatch: MCP-Protocol-Version '${header}' does not match _meta ${META_PROTOCOL} '${metaVersion}'`
      ),
    };
  }

  if (requested) {
    if (!isSupportedVersion(requested)) {
      return {
        version: requested,
        httpStatus: 400,
        error: rpcError(
          msg.id,
          UNSUPPORTED_PROTOCOL_VERSION,
          `Unsupported protocol version: ${requested}`,
          {
            supported: [...SUPPORTED_PROTOCOL_VERSIONS],
            requested,
          }
        ),
      };
    }
    return { version: requested };
  }

  // No version: treat as legacy 2025-03-26 for older clients
  return { version: LEGACY_DEFAULT };
}

function validateModernHeaders(
  req: NextRequest,
  msg: JsonRpcReq
): ReturnType<typeof rpcError> | null {
  const methodHdr = req.headers.get("mcp-method");
  const bodyMethod = msg.method ?? "";
  if (!methodHdr) {
    return rpcError(
      msg.id,
      HEADER_MISMATCH,
      "Header mismatch: required Mcp-Method header is missing"
    );
  }
  if (methodHdr !== bodyMethod) {
    return rpcError(
      msg.id,
      HEADER_MISMATCH,
      `Header mismatch: Mcp-Method header value '${methodHdr}' does not match body value '${bodyMethod}'`
    );
  }

  if (bodyMethod === "tools/call") {
    const nameHdr = decodeMcpHeaderValue(req.headers.get("mcp-name"));
    const params = (msg.params ?? {}) as Record<string, unknown>;
    const bodyName = typeof params.name === "string" ? params.name : "";
    if (!nameHdr) {
      return rpcError(
        msg.id,
        HEADER_MISMATCH,
        "Header mismatch: required Mcp-Name header is missing"
      );
    }
    if (nameHdr !== bodyName) {
      return rpcError(
        msg.id,
        HEADER_MISMATCH,
        `Header mismatch: Mcp-Name header value '${nameHdr}' does not match body value '${bodyName}'`
      );
    }
  }
  return null;
}

async function handleToolCall(name: string, args: Record<string, unknown>) {
  if (name === "has_new") {
    const has = await Promise.race([
      hasNewMessages(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("has_new timed out")), 8000)
      ),
    ]);
    return {
      content: [{ type: "text", text: has ? "A" : "B" }],
    };
  }
  if (name === "list_new_messages") {
    const control = await getControl();
    if (control.paused) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                paused: true,
                messages: [],
                notice:
                  "Muse ist pausiert (Stopp-Wort STOPP). Bitte keine Aufgaben bearbeiten, bis Stefan fortsetzt.",
              },
              null,
              2
            ),
          },
        ],
      };
    }
    const messages = await Promise.race([
      listMessages("new"),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("list_new_messages timed out")), 8000)
      ),
    ]);
    return {
      content: [{ type: "text", text: JSON.stringify({ messages }, null, 2) }],
    };
  }
  if (name === "mark_done") {
    const id = typeof args.id === "string" ? args.id : "";
    if (!id) throw new Error("id required");
    const result =
      typeof args.result === "string"
        ? args.result
        : args.result != null
          ? JSON.stringify(args.result)
          : null;
    const message = await Promise.race([
      markDone(id, result),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("mark_done timed out")), 8000)
      ),
    ]);
    return {
      content: [{ type: "text", text: JSON.stringify({ message }, null, 2) }],
    };
  }
  const str = (k: string) => (typeof args[k] === "string" ? (args[k] as string) : "");
  const json = (v: unknown) => ({
    content: [{ type: "text", text: JSON.stringify(v, null, 2) }],
  });
  const timed = <T,>(p: Promise<T>, label: string) =>
    Promise.race([
      p,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`${label} timed out`)), 8000)
      ),
    ]);
  if (name === "submit_draft" || name === "edit_result") {
    const id = str("id");
    if (!id) throw new Error("id required");
    const result =
      typeof args.result === "string"
        ? args.result
        : args.result != null
          ? JSON.stringify(args.result)
          : null;
    const message = await timed(
      name === "submit_draft" ? submitDraft(id, result) : editResult(id, result),
      name
    );
    return json({ message });
  }
  if (name === "retract_result") {
    const id = str("id");
    if (!id) throw new Error("id required");
    return json({ message: await timed(retractResult(id, str("reason") || null), name) });
  }
  if (name === "publish_result") {
    const id = str("id");
    if (!id) throw new Error("id required");
    return json({ message: await timed(publishResult(id), name) });
  }
  if (name === "get_control_state") {
    return json(await timed(getControl(), name));
  }
  if (name === "request_approval") {
    const approval = await timed(
      requestApproval({
        message_id: str("message_id") || null,
        action: str("action"),
        summary: str("summary"),
        details: args.details,
      }),
      name
    );
    return json({ approval });
  }
  if (name === "get_approval") {
    const id = str("id");
    if (!id) throw new Error("id required");
    return json({ approval: await timed(getApproval(id), name) });
  }
  if (name === "list_open_tasks") {
    const control = await getControl();
    if (control.paused) return json({ paused: true, total: 0, days: [], notice: "STOPP aktiv – nichts bearbeiten." });
    return json(await timed(listOpenTasks(), name));
  }
  if (name === "complete_task") {
    const id = typeof args.message_id === "string" ? args.message_id : "";
    if (!id) throw new Error("message_id required");
    const note = typeof args.result_note === "string" ? args.result_note : null;
    const m = await timed(completeTask(id, note), name);
    return json({ ok: true, message_id: m.id, status: m.status });
  }
  if (name === "post_update" || name === "ask_owner") {
    const id = typeof args.message_id === "string" ? args.message_id : "";
    const text = name === "ask_owner" ? args.question : args.text;
    if (!id || typeof text !== "string" || !text.trim()) throw new Error("message_id and text/question required");
    const n = await timed(postTaskNote(id, name === "ask_owner" ? "question" : "update", text), name);
    return json({ ok: true, note_id: n.id, waiting_for_answer: name === "ask_owner" });
  }
  if (name === "get_owner_replies") {
    const id = typeof args.message_id === "string" ? args.message_id : "";
    if (!id) throw new Error("message_id required");
    const notes = await timed(listTaskNotes(id), name);
    const lastQ = notes.map((n) => n.kind).lastIndexOf("question");
    const lastR = notes.map((n) => n.kind).lastIndexOf("reply");
    return json({
      message_id: id,
      waiting_for_answer: lastQ > lastR,
      replies: notes.filter((n) => n.author === "owner"),
      thread: notes,
    });
  }
  if (name === "get_task") {
    const id = typeof args.message_id === "string" ? args.message_id : "";
    if (!id) throw new Error("message_id required");
    return json(await timed(getTask(id), name));
  }
  if (name === "list_projects") {
    return json({ projects: await timed(listProjects(), name) });
  }
  if (name === "get_project") {
    const ref = typeof args.project === "string" ? args.project : "";
    if (!ref) throw new Error("project required");
    return json(await timed(getProject(ref), name));
  }
  if (name === "activate_project_from_calendar") {
    const ev = typeof args.event_id === "string" ? args.event_id.trim() : "";
    const ref = typeof args.project_name_or_id === "string" ? args.project_name_or_id : "";
    if (!ev || !ref) throw new Error("event_id and project_name_or_id required");
    const due = typeof args.due_at === "string" && args.due_at ? args.due_at : null;
    const r = await timed(activateProjectFromCalendar(ev, ref, due), name);
    if (!r.matched) return json({ ...r, hint: "Kein passendes Dokument – add_task_from_calendar mit dem Termintext nutzen." });
    return json(r);
  }
  if (name === "post_project_summary") {
    const ref = typeof args.project_id === "string" ? args.project_id : "";
    const act = typeof args.activation_id === "string" && args.activation_id ? args.activation_id : null;
    if (!ref && !act) throw new Error("project_id required");
    return json(await timed(projectSummary(ref || null, act, true), name));
  }
  if (name === "add_task_from_calendar") {
    const ev = typeof args.event_id === "string" ? args.event_id.trim() : "";
    const title = typeof args.title === "string" ? args.title : "";
    if (!ev || !title) throw new Error("event_id and title required");
    const due = typeof args.due_at === "string" && args.due_at ? args.due_at : null;
    const prompt = typeof args.prompt === "string" ? args.prompt : null;
    return json(await timed(addCalendarTask(ev, title, due, prompt), name));
  }
  if (name === "list_approvals") {
    const st = typeof args.status === "string" ? args.status : "approved";
    return json({ approvals: await timed(listApprovals(st), name) });
  }
  if (name.startsWith(ZAPIER_PREFIX)) {
    return (await callZapierTool(name, args)) as {
      content: { type: string; text: string }[];
    };
  }
  if (name === "get_budget") {
    return json(await timed(getBudget(), name));
  }
  if (name === "get_grants") {
    return json({ grants: await timed(listGrants(), name) });
  }
  throw new Error(`Unknown tool: ${name}`);
}

async function dispatch(
  msg: JsonRpcReq,
  version: string
): Promise<{ payload: unknown | null; httpStatus?: number }> {
  const method = msg.method ?? "";
  const id = msg.id;
  const params = (msg.params ?? {}) as Record<string, unknown>;
  const modern = isModern(version);

  if (
    id === undefined &&
    (method.startsWith("notifications/") || method === "initialized")
  ) {
    return { payload: null };
  }
  if (method === "notifications/initialized" || method === "initialized") {
    return { payload: null };
  }

  switch (method) {
    case "server/discover": {
      const result = wrapModernResult({
        supportedVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
        capabilities: { tools: {} },
        instructions: INSTRUCTIONS,
        ttlMs: 3600000,
        cacheScope: "public",
      });
      return { payload: rpcResult(id, result) };
    }
    case "initialize": {
      // Legacy handshake; also accept if client somehow asks for modern
      const negotiated = negotiateInitializeVersion(params.protocolVersion);
      return {
        payload: rpcResult(id, {
          protocolVersion: negotiated,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        }),
      };
    }
    case "ping": {
      if (modern) {
        // Removed in 2026-07-28
        return {
          payload: rpcError(id, -32601, "Method not found: ping"),
          httpStatus: 404,
        };
      }
      return { payload: rpcResult(id, {}) };
    }
    case "tools/list": {
      let zt: unknown[] = [];
      if (zapierEnabled()) {
        try {
          zt = await listZapierTools();
        } catch (e) {
          console.error("zapier tools/list failed", e instanceof Error ? e.message : e);
        }
      }
      const allTools = [...TOOLS, ...zt];
      if (modern) {
        return {
          payload: rpcResult(
            id,
            wrapModernResult({
              tools: allTools,
              ttlMs: 60000,
              cacheScope: "private",
            })
          ),
        };
      }
      return { payload: rpcResult(id, { tools: allTools }) };
    }
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const args =
        params.arguments && typeof params.arguments === "object"
          ? (params.arguments as Record<string, unknown>)
          : {};
      try {
        const toolResult = await handleToolCall(name, args);
        if (modern) {
          return {
            payload: rpcResult(id, wrapModernResult({ ...toolResult })),
          };
        }
        return { payload: rpcResult(id, toolResult) };
      } catch (e) {
        const m = e instanceof Error ? e.message : "tool error";
        const errResult = {
          content: [{ type: "text", text: m }],
          isError: true,
        };
        if (modern) {
          return {
            payload: rpcResult(id, wrapModernResult(errResult)),
          };
        }
        return { payload: rpcResult(id, errResult) };
      }
    }
    case "subscriptions/listen": {
      // No long-lived fan-out; acknowledge then close via SSE in POST handler
      return {
        payload: {
          __subscriptionsListen: true,
          id,
          version,
        },
      };
    }
    default:
      return {
        payload: rpcError(id, -32601, `Method not found: ${method}`),
        httpStatus: modern ? 404 : 200,
      };
  }
}

function unauthorized() {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

/**
 * GET — removed in 2026-07-28. Legacy clients may probe Accept: event-stream;
 * answer 405 for JSON, brief SSE for legacy probes.
 */
export async function GET(req: NextRequest) {
  const auth = requireBearerKey(req);
  if (!auth.ok) return unauthorized();

  const accept = req.headers.get("accept") ?? "";
  const proto = req.headers.get("mcp-protocol-version");
  if (proto === MODERN_VERSION || !accept.toLowerCase().includes("text/event-stream")) {
    return new Response(null, {
      status: 405,
      headers: {
        ...corsHeaders(),
        Allow: "POST, OPTIONS",
      },
    });
  }

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(enc.encode(": muse-inbox mcp ready\n\n"));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      ...corsHeaders(),
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function DELETE(req: NextRequest) {
  const auth = requireBearerKey(req);
  if (!auth.ok) return unauthorized();
  return new Response(null, {
    status: 405,
    headers: {
      ...corsHeaders(),
      Allow: "GET, POST, OPTIONS",
    },
  });
}

function subscriptionsListenSse(
  id: JsonRpcId | undefined,
  version: string
): Response {
  const subId = randomUUID();
  const ack = {
    jsonrpc: "2.0",
    method: "notifications/subscriptions/acknowledged",
    params: {
      _meta: { "io.modelcontextprotocol/subscriptionId": subId },
    },
  };
  // Spec: long-lived stream; we have no listChanged — acknowledge and close.
  const final = {
    jsonrpc: "2.0",
    id: id ?? null,
    result: wrapModernResult({
      subscriptionId: subId,
    }),
  };
  const body =
    `event: message\ndata: ${JSON.stringify(ack)}\n\n` +
    `event: message\ndata: ${JSON.stringify(final)}\n\n`;
  return new Response(body, {
    status: 200,
    headers: {
      ...corsHeaders(),
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "MCP-Protocol-Version": version,
    },
  });
}

export async function POST(req: NextRequest) {
  const auth = requireBearerKey(req);
  if (!auth.ok) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(rpcError(null, -32700, "Parse error"), { status: 400 });
  }

  // Spec 2026: single message; still tolerate legacy batches
  const messages = Array.isArray(body)
    ? (body as JsonRpcReq[])
    : [body as JsonRpcReq];
  const primary = messages[0] ?? {};
  const isInitialize = messages.some((m) => m?.method === "initialize");

  const resolved = resolveProtocolVersion(req, primary);
  if (resolved.error) {
    return jsonResponse(resolved.error, {
      status: resolved.httpStatus ?? 400,
      protocolVersion: isSupportedVersion(resolved.version)
        ? resolved.version
        : undefined,
    });
  }
  let version = resolved.version;

  // Modern clients must send matching headers (Mcp-Method / Mcp-Name)
  if (isModern(version) && primary.method !== "server/discover") {
    // discover also requires Mcp-Method per "all requests" — validate always
  }
  if (isModern(version)) {
    const hdrErr = validateModernHeaders(req, primary);
    if (hdrErr) {
      return jsonResponse(hdrErr, {
        status: 400,
        protocolVersion: version,
      });
    }
  }

  const sessionId = isModern(version)
    ? undefined
    : sessionIdFor(req, isInitialize || true);

  const responses: unknown[] = [];
  let httpStatus: number | undefined;

  for (const msg of messages) {
    // Re-resolve per message for batches (rare)
    const r = resolveProtocolVersion(req, msg);
    if (r.error) {
      responses.push(r.error);
      httpStatus = r.httpStatus ?? 400;
      continue;
    }
    version = r.version;

    if (isModern(version)) {
      const hdrErr = validateModernHeaders(req, msg);
      if (hdrErr) {
        responses.push(hdrErr);
        httpStatus = 400;
        continue;
      }
    }

    const out = await dispatch(msg, version);
    if (
      out.payload &&
      typeof out.payload === "object" &&
      (out.payload as { __subscriptionsListen?: boolean }).__subscriptionsListen
    ) {
      const listen = out.payload as {
        id?: JsonRpcId;
        version: string;
      };
      return subscriptionsListenSse(listen.id, listen.version);
    }
    if (out.httpStatus) httpStatus = out.httpStatus;
    if (out.payload !== null) responses.push(out.payload);
  }

  if (responses.length === 0) {
    const headers: Record<string, string> = {
      ...corsHeaders(),
      "MCP-Protocol-Version": version,
    };
    if (sessionId && !isModern(version)) {
      headers["Mcp-Session-Id"] = sessionId;
    }
    return new Response(null, { status: 202, headers });
  }

  const payload = Array.isArray(body) ? responses : responses[0];
  return respondRpc(req, payload, {
    sessionId,
    protocolVersion: version,
    status: httpStatus,
  });
}
