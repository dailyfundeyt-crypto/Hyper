/**
 * Zapier MCP proxy with server-side grant enforcement.
 * Enabled only when process.env.ZAPIER_MCP_URL is set (secret, never logged).
 * Tools are exposed as `zapier_<name>`; every call is logged to muse_tool_log.
 */
import { getSupabase } from "./supabase";
import { getExpectedApiKey } from "./auth";
import { getApproval, getMessage, isPaused } from "./messages";

export const ZAPIER_PREFIX = "zapier_";

type Tool = { name: string; description?: string; inputSchema?: Record<string, unknown> };

export function zapierEnabled(): boolean {
  return !!process.env.ZAPIER_MCP_URL;
}

let sessionId: string | null = null;
let toolCache: { at: number; tools: Tool[] } | null = null;
let rpcId = 1;

function parseBody(text: string, contentType: string | null): Record<string, unknown> {
  if (contentType?.includes("text/event-stream")) {
    let last: Record<string, unknown> | null = null;
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      try {
        const obj = JSON.parse(line.slice(5).trim());
        if (obj && (obj.result !== undefined || obj.error !== undefined)) last = obj;
      } catch {
        /* ignore */
      }
    }
    if (last) return last;
    throw new Error("zapier: no JSON-RPC response in SSE stream");
  }
  return JSON.parse(text);
}

async function post(method: string, params?: Record<string, unknown>, notify = false) {
  const url = process.env.ZAPIER_MCP_URL;
  if (!url) throw new Error("Zapier proxy disabled (ZAPIER_MCP_URL not set)");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-06-18",
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  const token = process.env.ZAPIER_MCP_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  const body = notify
    ? { jsonrpc: "2.0", method, params: params ?? {} }
    : { jsonrpc: "2.0", id: rpcId++, method, params: params ?? {} };
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const sid = res.headers.get("mcp-session-id");
  if (sid) sessionId = sid;
  if (notify) return null;
  const text = await res.text();
  if (!res.ok) throw new Error(`zapier HTTP ${res.status}`);
  const msg = parseBody(text, res.headers.get("content-type"));
  if (msg.error) {
    const e = msg.error as { message?: string };
    throw new Error(`zapier: ${e.message ?? "error"}`);
  }
  return msg.result as Record<string, unknown>;
}

async function ensureSession() {
  if (sessionId) return;
  await post("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "muse-inbox-proxy", version: "0.2.0" },
  });
  await post("notifications/initialized", {}, true).catch(() => null);
}

async function rpc(method: string, params?: Record<string, unknown>) {
  await ensureSession();
  try {
    return await post(method, params);
  } catch (e) {
    // session may have expired: retry once with a fresh session
    sessionId = null;
    await ensureSession();
    if (e instanceof Error && /HTTP 4\d\d/.test(e.message)) return post(method, params);
    throw e;
  }
}

const GUARD_PROPS = {
  message_id: {
    type: "string",
    description:
      "Inbox-Nachricht (UUID) von Stefan, aus der der Auftrag stammt. Zusammen mit approval_id Pflicht für jede Schreib-/Ausführ-Aktion (inkl. Löschen/Verschieben, Ordner, Käufe, Nachrichten nach außen).",
  },
  approval_id: {
    type: "string",
    description:
      "ID aus request_approval(message_id=…), die Stefan in der Inbox mit Ja bestätigt hat (get_approval → status approved). Einmal verwendbar. Damit sofort ausführen – keine Rückfrage im Chat.",
  },
  dry_run: {
    type: "boolean",
    description: "true = nur prüfen, ob der Aufruf erlaubt wäre (nichts ausführen, Freigabe wird nicht verbraucht).",
  },
};

export async function listZapierTools(): Promise<Tool[]> {
  if (!zapierEnabled()) return [];
  if (toolCache && Date.now() - toolCache.at < 60_000) return toolCache.tools;
  const result = await rpc("tools/list", {});
  const tools = ((result?.tools as Tool[]) ?? []).map((t) => {
    const schema = (t.inputSchema ?? { type: "object", properties: {} }) as Record<string, unknown>;
    const props = { ...((schema.properties as Record<string, unknown>) ?? {}), ...GUARD_PROPS };
    return {
      name: ZAPIER_PREFIX + t.name,
      description: `[Zapier via Muse Inbox – Lesen frei. Schreiben/Ausführen/Löschen/Verschieben: request_approval(message_id,…) → Stefan tippt Ja in der Inbox → hier mit message_id + approval_id aufrufen, ohne Chat-Rückfrage. dry_run=true prüft nur.] ${t.description ?? ""}`.slice(0, 1024),
      inputSchema: { ...schema, type: "object", properties: props },
    };
  });
  toolCache = { at: Date.now(), tools };
  return tools;
}

export type Risk =
  | "delete"
  | "outbound_message"
  | "purchase"
  | "ebay"
  | "admin"
  | "write"
  | "normal";

/** Text describing the *effective* action (Agentic mode: generic execute_* tools carry the real action in args). */
function actionText(toolName: string, args: Record<string, unknown>): string {
  const parts = [toolName, args.action, args.tool_name, args.selected_api, args.code_action_name];
  return parts.filter((x) => typeof x === "string").join(" ").toLowerCase();
}

const RX_DELETE = /(delete|trash|remove|destroy|purge|erase|wipe|move|unshare)/;
const RX_PURCHASE = /(purchase|buy|checkout|create_order|order_create|place_order|payment|pay_|charge|refund|transfer)/;
const RX_OUTBOUND =
  /(send|reply|forward|post_|_post|publish|tweet|comment|invite|share|message|sms|whatsapp|slack|telegram|feedback)/;
const RX_READ = /(^|_)(find|get|list|search|read|lookup|retrieve|fetch|download|export)(_|$)/;
const RX_OUTBOUND_DIRECT = /(^|_)(send|reply|forward|post|publish|tweet|comment|invite|share|sms)(_|$)/;
const RX_WRITE = /(^|_)(create|update|add|upload|copy|rename|set|edit|write|insert|append|replace|import|change|duplicate|make|new|enable|run)(_|$)/;
const ADMIN_TOOLS = new Set(["write_code_action", "auto_provision_mcp", "manage_zapier_connections"]);

export function classify(toolName: string, args: Record<string, unknown>): Risk {
  const n = toolName.toLowerCase();
  const a = actionText(toolName, args);
  const blob = (a + " " + JSON.stringify(args).toLowerCase()).slice(0, 8000);
  if (/ebay/.test(blob)) return "ebay";
  if (ADMIN_TOOLS.has(n)) return "admin";
  if (n === "delete_zapier_skill") return "delete";
  if (n === "send_feedback") return "outbound_message";
  if (n === "execute_zapier_write_action" || n.startsWith("execute_") && n.includes("write")) {
    if (RX_DELETE.test(a)) return "delete";
    if (RX_PURCHASE.test(a)) return "purchase";
    if (RX_OUTBOUND.test(a)) return "outbound_message";
    return "write";
  }
  if (n.startsWith("execute_")) return "normal"; // read actions
  if (RX_DELETE.test(n) && !/disable/.test(n)) return "delete";
  // Direct (non-agentic) Zapier tools, e.g. google_drive_create_folder / gmail_find_email
  if (RX_READ.test(n)) return "normal";
  if (RX_PURCHASE.test(n)) return "purchase";
  if (RX_OUTBOUND_DIRECT.test(n)) return "outbound_message";
  if (RX_WRITE.test(n)) return "write";
  return "normal";
}

const LEGACY_IDS = [
  "1t-2BRAsq6T6A9_MxCC-2sgP8lFE8o8O1NP-d7_2m5kU",
  "1O_pLPesENoD_W10oixYtJYoUVcAMkQ1Z",
  "1ZlKkqSZm19NguVKdVYkueoDSc43GvHN1",
];
const DUSTY_FOLDER = "1a00e-vC4332HAwmewBnur5L7pQrs_jlB";
const LOCKED = ["0528", "0548", "0551", "0553", "0572", "0626"];

/** IDs Muse may write into, taken from active write/edit grants. */
async function writableIds(): Promise<string[]> {
  const { data } = await getSupabase().rpc("muse_list_grants", { p_key: getExpectedApiKey() });
  const ids: string[] = [];
  for (const g of (data as { action: string; scope: Record<string, unknown> }[]) ?? []) {
    if (!/\.(write|edit)$/.test(g.action)) continue;
    const sc = g.scope ?? {};
    for (const k of ["folder_id", "spreadsheet_id"]) if (typeof sc[k] === "string") ids.push(sc[k] as string);
    const sub = sc.subfolders as Record<string, string> | undefined;
    if (sub) ids.push(...Object.values(sub));
  }
  return ids;
}

function summarize(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    out[k] = s && s.length > 200 ? s.slice(0, 200) + "…" : s;
  }
  return out;
}

async function log(
  tool: string,
  args: Record<string, unknown>,
  status: string,
  detail: string | null,
  messageId: string | null,
  approvalId: string | null
) {
  try {
    await getSupabase().rpc("muse_log_tool", {
      p_key: getExpectedApiKey(),
      p_tool: tool,
      p_args: summarize(args),
      p_status: status,
      p_detail: detail,
      p_message_id: messageId && /^[0-9a-f-]{36}$/i.test(messageId) ? messageId : null,
      p_approval_id: approvalId && /^[0-9a-f-]{36}$/i.test(approvalId) ? approvalId : null,
    });
  } catch (e) {
    console.error("muse_log_tool failed", e);
  }
}

async function consumeApproval(id: string, action: string | null) {
  const { data, error } = await getSupabase().rpc("muse_consume_approval", {
    p_key: getExpectedApiKey(),
    p_id: id,
    p_action: action,
  });
  if (error) throw new Error(error.message);
  return data;
}

function blocked(text: string) {
  return { content: [{ type: "text", text: `BLOCKIERT: ${text}` }], isError: true };
}

const LOCKED_SHEET = "1WXIW7s2OSQtrDkAm8W4PuEnNRUma83tOnMsq2q13o6M";

/** Protected IDs (legacy Store-5 files, locked product IDs in the Dusty sheet) touched by these args. */
export function protectedHits(argText: string): string[] {
  const hits = LEGACY_IDS.filter((id) => argText.includes(id));
  if (argText.includes(LOCKED_SHEET))
    hits.push(...LOCKED.filter((l) => new RegExp(`(^|[^0-9])${l}([^0-9]|$)`).test(argText)));
  return hits;
}

type ApprovalRow = {
  id: string;
  message_id: string | null;
  action: string;
  details: Record<string, unknown> | null;
  status: string;
  used_at?: string | null;
};

/** Pure check of an approval against a call (DB re-checks atomically on consume). */
export function checkApproval(
  ap: ApprovalRow,
  opts: { messageId: string | null; risk: Risk; hits: string[] }
): string | null {
  if (opts.messageId && ap.message_id !== opts.messageId)
    return "Freigabe gehört nicht zu dieser message_id.";
  if (!opts.messageId && ap.message_id)
    return "message_id fehlt (die Freigabe ist mit einer Inbox-Nachricht verknüpft – message_id mitsenden).";
  if (ap.status !== "approved") return `Freigabe ist nicht erteilt (status ${ap.status}).`;
  if (ap.used_at) return "Freigabe wurde bereits verwendet – neue request_approval nötig.";
  if (opts.risk === "purchase" && ap.action.toLowerCase() !== "purchase")
    return "Käufe brauchen request_approval mit action=purchase und details.amount_eur (Budgetprüfung).";
  const det = JSON.stringify(ap.details ?? {});
  const missing = opts.hits.filter((h) => !det.includes(h));
  if (missing.length)
    return `Geschützte IDs (${missing.join(", ")}) nur, wenn die Freigabe sie in details ausdrücklich nennt.`;
  return null;
}

/** Old narrow fallback: new folder inside Dusty, named exactly in the inbox message. */
async function dustyFolderFallback(
  a: string,
  args: Record<string, unknown>,
  argText: string,
  mid: string | null
): Promise<boolean> {
  if (!(/folder/.test(a) && /(create|new|add)/.test(a) && argText.includes(DUSTY_FOLDER) && mid)) return false;
  const msg = await getMessage(mid).catch(() => null);
  if (!msg) return false;
  const t = msg.text.toLowerCase();
  if (!(/(ordner|folder)/.test(t) && /(erstell|anleg|create|neu|mach)/.test(t))) return false;
  const p = (args.params ?? {}) as Record<string, unknown>;
  const nameVal = ["title", "name", "folder_name", "folderName", "new_folder_name"]
    .map((k) => p[k] ?? args[k])
    .find((v) => typeof v === "string" && v.trim()) as string | undefined;
  if (!nameVal) return false;
  const norm = (x: string) => x.toLowerCase().replace(/[„“"'»«]/g, "").trim();
  return norm(t).includes(norm(nameVal));
}

export async function callZapierTool(prefixed: string, rawArgs: Record<string, unknown>) {
  const tool = prefixed.slice(ZAPIER_PREFIX.length);
  const { message_id, approval_id, dry_run, ...args } = rawArgs;
  const mid = typeof message_id === "string" && message_id.trim() ? message_id.trim() : null;
  const aid = typeof approval_id === "string" && approval_id.trim() ? approval_id.trim() : null;
  const dry = dry_run === true || dry_run === "true";

  if (!zapierEnabled() && !dry) {
    await log(tool, args, "blocked", "proxy disabled", mid, aid);
    return blocked("Zapier-Proxy ist nicht aktiviert.");
  }
  if (await isPaused()) {
    await log(tool, args, "blocked", "paused", mid, aid);
    return blocked("Muse ist pausiert (STOPP).");
  }

  const risk = classify(tool, args);
  const argText = JSON.stringify(args);
  const hits = risk === "normal" ? [] : protectedHits(argText);
  let via = "read";
  try {
    if (risk !== "normal") {
      const a = actionText(tool, args);
      if (aid) {
        // NEW RULE: inbox order (message_id) + approval Stefan tapped "Ja" on (approval_id) => execute anything.
        const ap = (await getApproval(aid)) as unknown as ApprovalRow;
        const err = checkApproval(ap, { messageId: mid, risk, hits });
        if (err) throw new Error(err);
        if (!dry) {
          if (mid) {
            const { error } = await getSupabase().rpc("muse_consume_linked_approval", {
              p_key: getExpectedApiKey(),
              p_id: aid,
              p_message_id: mid,
              p_action: risk === "purchase" ? "purchase" : null,
              p_tool: tool,
            });
            if (error) throw new Error(error.message);
          } else {
            // legacy approval without linked message (outbound/purchase type must match)
            await consumeApproval(aid, risk === "outbound_message" || risk === "purchase" ? risk : null);
          }
        }
        via = mid ? "approval+message" : "approval(legacy)";
      } else {
        if (hits.length) throw new Error(`Geschützte IDs (${hits.join(", ")}) nur mit Freigabe, die sie in details nennt.`);
        const isGoogle = /(google|drive|sheet|docs|gmail)/.test(a);
        if (risk === "write" && (await dustyFolderFallback(a, args, argText, mid))) {
          via = "dusty_folder_fallback";
        } else if (risk === "write" && isGoogle && (await writableIds()).some((id) => argText.includes(id))) {
          via = "grant_scope";
        } else {
          throw new Error(
            `${risk}: braucht message_id + approval_id. Ablauf: request_approval(message_id, action, summary, details) → Stefan tippt Ja in der Inbox → get_approval (approved) → diesen Aufruf mit message_id + approval_id wiederholen.`
          );
        }
      }
    }
  } catch (e) {
    const m = e instanceof Error ? e.message : "blocked";
    await log(tool, args, "blocked", `${risk}: ${m}${dry ? " (dry_run)" : ""}`, mid, aid);
    return blocked(m);
  }

  if (dry) {
    await log(tool, args, "dry_run_ok", `${risk} via ${via}`, mid, aid);
    return {
      content: [{ type: "text", text: `OK (dry_run): ${tool} wäre erlaubt (Risiko ${risk}, über ${via}). Nichts ausgeführt, Freigabe nicht verbraucht.` }],
    };
  }

  try {
    const result = (await rpc("tools/call", { name: tool, arguments: args })) ?? {};
    const isErr = result.isError === true;
    await log(tool, args, isErr ? "forwarded_error" : "forwarded_ok", `${risk} via ${via}`, mid, aid);
    return result;
  } catch (e) {
    const m = e instanceof Error ? e.message : "error";
    await log(tool, args, "forwarded_error", `${risk} via ${via}: ${m}`, mid, aid);
    throw e;
  }
}
