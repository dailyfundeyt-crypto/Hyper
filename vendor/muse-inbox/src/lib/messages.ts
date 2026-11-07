import {
  getSupabase,
  MuseAgent,
  MuseAttachment,
  MuseMessage,
  MuseApproval,
  MuseControl,
} from "./supabase";
import { getExpectedApiKey } from "./auth";
import { enrichAttachments } from "./attachments";
import { parseLinks } from "./links";
import { ensureAlwaysActiveToday, listProjects, projectUrl } from "./projects";

async function withSignedAttachments(msg: MuseMessage): Promise<MuseMessage> {
  const attachments = await enrichAttachments(
    (msg.attachments as MuseAttachment[] | null) ?? []
  );
  return { ...msg, attachments };
}

export async function listMessages(status: string = "new"): Promise<MuseMessage[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("muse_list_messages", {
    p_key: getExpectedApiKey(),
    p_status: status,
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as MuseMessage[];
  return Promise.all(rows.map(withSignedAttachments));
}

export async function getMessage(id: string): Promise<MuseMessage> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("muse_get_message", {
    p_key: getExpectedApiKey(),
    p_id: id,
  });
  if (error) throw new Error(error.message);
  return withSignedAttachments(data as MuseMessage);
}

export async function createMessage(
  text: string,
  agent: string = "muse",
  opts?: {
    source?: string | null;
    attachments?: MuseAttachment[] | null;
  }
): Promise<MuseMessage> {
  const supabase = getSupabase();
  const attachments = opts?.attachments ?? [];
  const { data, error } = await supabase.rpc("muse_create_message", {
    p_key: getExpectedApiKey(),
    p_text: text,
    p_agent: agent || "muse",
    p_source: opts?.source ?? null,
    p_attachments: attachments,
  });
  if (error) throw new Error(error.message);
  const msg = data as MuseMessage;

  const webhook = process.env.WEBHOOK_URL;
  if (webhook) {
    try {
      await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(msg),
      });
    } catch (e) {
      console.error("webhook failed", e);
    }
  }
  return withSignedAttachments(msg);
}

export async function markDone(id: string, result?: string | null): Promise<MuseMessage> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("muse_mark_done", {
    p_key: getExpectedApiKey(),
    p_id: id,
    p_result: result ?? null,
  });
  if (error) throw new Error(error.message);
  return withSignedAttachments(data as MuseMessage);
}

export async function listAgents(): Promise<MuseAgent[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("muse_list_agents", {
    p_key: getExpectedApiKey(),
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as MuseAgent[];
}

/** Poll until status=done or timeoutMs elapses. Interval ~2s. */
export async function waitForResult(
  id: string,
  timeoutMs = 50_000,
  intervalMs = 2_000
): Promise<MuseMessage | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const msg = await getMessage(id);
    if (msg.status === "done") return msg;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((r) => setTimeout(r, Math.min(intervalMs, remaining)));
  }
  try {
    const msg = await getMessage(id);
    if (msg.status === "done") return msg;
  } catch {
    /* ignore */
  }
  return null;
}

/** Cheap existence check: any status=new for agent muse|null. */
export async function hasNewMessages(): Promise<boolean> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("muse_has_new", {
    p_key: getExpectedApiKey(),
  });
  if (error) throw new Error(error.message);
  return data === true;
}

// ---- Drafts / retract / publish / read ------------------------------------

async function rpcMessage(fn: string, args: Record<string, unknown>): Promise<MuseMessage> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc(fn, { p_key: getExpectedApiKey(), ...args });
  if (error) throw new Error(error.message);
  return withSignedAttachments(data as MuseMessage);
}

export const submitDraft = (id: string, result: string | null) =>
  rpcMessage("muse_submit_draft", { p_id: id, p_result: result });
export const editResult = (id: string, result: string | null) =>
  rpcMessage("muse_edit_result", { p_id: id, p_result: result });
export const retractResult = (id: string, reason?: string | null) =>
  rpcMessage("muse_retract_result", { p_id: id, p_reason: reason ?? null });
export const publishResult = (id: string) =>
  rpcMessage("muse_publish_result", { p_id: id });
/** Owner read: sets read_at only when result_status = published. */
export const markRead = (id: string) => rpcMessage("muse_mark_read", { p_id: id });

// ---- Kill switch -----------------------------------------------------------

export async function getControl(): Promise<MuseControl> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("muse_get_control", { p_key: getExpectedApiKey() });
  if (error) throw new Error(error.message);
  return data as MuseControl;
}

export async function isPaused(): Promise<boolean> {
  return (await getControl()).paused === true;
}

/** Stop: allowed with the Muse API key. */
export async function stopMuse(by = "api"): Promise<MuseControl> {
  const supabase = getSupabase();
  const { error } = await supabase.rpc("muse_set_paused", {
    p_key: getExpectedApiKey(),
    p_paused: true,
    p_by: by,
  });
  if (error) throw new Error(error.message);
  return getControl();
}

/** Resume: owner key only. */
export async function resumeMuse(ownerKey: string): Promise<MuseControl> {
  const supabase = getSupabase();
  const { error } = await supabase.rpc("muse_owner_set_paused", {
    p_owner_key: ownerKey,
    p_paused: false,
  });
  if (error) throw new Error(error.message);
  return getControl();
}

// ---- Approvals -------------------------------------------------------------

export async function requestApproval(input: {
  message_id?: string | null;
  action: string;
  summary: string;
  details?: unknown;
}): Promise<MuseApproval> {
  const supabase = getSupabase();
  const details =
    input.details && typeof input.details === "object"
      ? input.details
      : input.details != null
        ? { text: String(input.details) }
        : {};
  const { data, error } = await supabase.rpc("muse_request_approval", {
    p_key: getExpectedApiKey(),
    p_message_id: input.message_id || null,
    p_action: input.action,
    p_summary: input.summary,
    p_details: details,
  });
  if (error) throw new Error(error.message);
  return data as MuseApproval;
}

export async function getApproval(id: string): Promise<MuseApproval> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("muse_get_approval", {
    p_key: getExpectedApiKey(),
    p_id: id,
  });
  if (error) throw new Error(error.message);
  return data as MuseApproval;
}

export async function listApprovals(status = "pending", ownerKey?: string | null): Promise<MuseApproval[]> {
  const supabase = getSupabase();
  const { data, error } = ownerKey
    ? await supabase.rpc("muse_owner_list_approvals", { p_owner_key: ownerKey, p_status: status })
    : await supabase.rpc("muse_list_approvals", { p_key: getExpectedApiKey(), p_status: status });
  if (error) throw new Error(error.message);
  return (data ?? []) as MuseApproval[];
}

export async function decideApproval(
  ownerKey: string,
  id: string,
  decision: "approved" | "denied",
  note?: string | null
): Promise<MuseApproval> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("muse_decide_approval", {
    p_owner_key: ownerKey,
    p_id: id,
    p_decision: decision,
    p_note: note ?? null,
  });
  if (error) throw new Error(error.message);
  return data as MuseApproval;
}

export async function checkOwnerKey(ownerKey: string): Promise<boolean> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("muse_check_owner", { p_owner_key: ownerKey });
  if (error) return false;
  return data === true;
}

/** Map RPC error text to an HTTP status. */
export function httpStatusFor(msg: string): number {
  const m = msg.toLowerCase();
  if (m.includes("owner unauthorized")) return 403;
  if (m.includes("unauthorized") || m.includes("requires owner")) return 403;
  if (m.includes("not found")) return 404;
  if (
    m.includes("locked") ||
    m.includes("paused") ||
    m.includes("only drafts") ||
    m.includes("nothing to retract") ||
    m.includes("no result") ||
    m.includes("already decided")
  )
    return 409;
  if (m.includes("required") || m.includes("must be") || m.includes("invalid input syntax")) return 400;
  return 500;
}

// ---- Standing grants (owner-set pre-approvals) -----------------------------

export type MuseGrant = {
  id: string;
  created_at: string;
  action: string;
  scope: Record<string, unknown>;
  description: string;
  active: boolean;
  expires_at: string | null;
  revoked_at: string | null;
  created_by: string;
};

export async function listGrants(ownerKey?: string | null): Promise<MuseGrant[]> {
  const supabase = getSupabase();
  const { data, error } = ownerKey
    ? await supabase.rpc("muse_owner_list_grants", { p_owner_key: ownerKey })
    : await supabase.rpc("muse_list_grants", { p_key: getExpectedApiKey() });
  if (error) throw new Error(error.message);
  return (data ?? []) as MuseGrant[];
}

export async function addGrant(
  ownerKey: string,
  g: { action: string; scope?: unknown; description: string; expires_at?: string | null }
): Promise<MuseGrant> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("muse_owner_add_grant", {
    p_owner_key: ownerKey,
    p_action: g.action,
    p_scope: g.scope && typeof g.scope === "object" ? g.scope : {},
    p_description: g.description,
    p_expires_at: g.expires_at ?? null,
  });
  if (error) throw new Error(error.message);
  return data as MuseGrant;
}

export async function revokeGrant(ownerKey: string, id: string): Promise<MuseGrant> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("muse_owner_revoke_grant", {
    p_owner_key: ownerKey,
    p_id: id,
  });
  if (error) throw new Error(error.message);
  return data as MuseGrant;
}

// ---- Budget ledger (Store-Mandat Dusty) ------------------------------------

export type MuseBudget = {
  month: string;
  budget_eur: number;
  spent_eur: number;
  remaining_eur: number;
  currency: "EUR";
  entries?: unknown[];
};

export async function getBudget(ownerKey?: string | null): Promise<MuseBudget> {
  const supabase = getSupabase();
  const { data, error } = ownerKey
    ? await supabase.rpc("muse_owner_budget_status", { p_owner_key: ownerKey })
    : await supabase.rpc("muse_budget_status", { p_key: getExpectedApiKey() });
  if (error) throw new Error(error.message);
  return data as MuseBudget;
}

// ---- Daily task queue ------------------------------------------------------

/** Owner tasks = not-done inbox messages for Muse, oldest first, grouped by Berlin day. */
export async function listOpenTasks() {
  // "immer aktiv" docs get today's activation (no-op while STOPP / when already done today).
  await ensureAlwaysActiveToday().catch(() => 0);
  const rows = (await listMessages("new"))
    .filter((m) => !m.agent || m.agent === "muse")
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const day = (iso: string) =>
    new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  type T = { message_id: string; text: string; created_at: string; waiting_for_answer: boolean; due_at?: string | null; source?: string | null; attachments?: unknown; project_id?: string | null; activation_id?: string | null; project_url?: string };
  const groups: { day: string; tasks: T[] }[] = [];
  for (const m of rows) {
    const d = day(m.created_at);
    let g = groups.find((x) => x.day === d);
    if (!g) groups.push((g = { day: d, tasks: [] }));
    g.tasks.push({
      message_id: m.id,
      text: m.text,
      created_at: m.created_at,
      waiting_for_answer: m.task_state === "waiting",
      due_at: m.due_at ?? null,
      source: m.source ?? null,
      attachments: [...((m.attachments as unknown[] | null) ?? []), ...parseLinks(m.text)],
      project_id: m.project_id ?? null,
      activation_id: m.activation_id ?? null,
      ...(m.project_id ? { project_url: projectUrl(m.project_id) } : {}),
    });
  }
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  const projects_today = (await listProjects().catch(() => []))
    .filter((p) => p.active_today)
    .map((p) => {
      const acts = ((p.activations as Record<string, unknown>[]) ?? []).filter((a) => a.active_on === today);
      return { project_id: p.id, name: p.name, url: p.url, always_active: p.always_active, attachments: p.attachments,
        activations: acts.map((a) => ({ activation_id: a.activation_id, event_id: a.event_id, source: a.source, due_at: a.due_at })) };
    });
  return { total: rows.length, days: groups, projects_today };
}

/** One task incl. file + link attachments. */
export async function getTask(id: string) {
  const m = await getMessage(id);
  return {
    message_id: m.id,
    text: m.text,
    status: m.status,
    created_at: m.created_at,
    waiting_for_answer: m.task_state === "waiting",
    due_at: m.due_at ?? null,
    source: m.source ?? null,
    attachments: [...((m.attachments as unknown[] | null) ?? []), ...parseLinks(m.text)],
  };
}

export async function completeTask(id: string, note: string | null) {
  return markDone(id, note);
}

// ---- Public flag token (hooks) ---------------------------------------------

export async function flagByToken(token: string): Promise<"A" | "B" | null> {
  const { data, error } = await getSupabase().rpc("muse_flag_by_token", { p_token: token });
  if (error) throw new Error(error.message);
  return data === "A" || data === "B" ? data : null;
}

export async function rotateFlagToken(ownerKey: string): Promise<string> {
  const { data, error } = await getSupabase().rpc("muse_owner_rotate_flag_token", { p_owner_key: ownerKey });
  if (error) throw new Error(error.message);
  return data as string;
}

// ---- Task threads (updates / questions / owner replies) + calendar ---------

export type TaskNote = {
  id: string;
  message_id: string;
  kind: "update" | "question" | "reply";
  author: "muse" | "owner";
  text: string;
  created_at: string;
};

export async function postTaskNote(id: string, kind: "update" | "question", text: string): Promise<TaskNote> {
  const { data, error } = await getSupabase().rpc("muse_task_post", {
    p_key: getExpectedApiKey(), p_message_id: id, p_kind: kind, p_text: text,
  });
  if (error) throw new Error(error.message);
  return data as TaskNote;
}

export async function listTaskNotes(id: string | null): Promise<TaskNote[]> {
  const { data, error } = await getSupabase().rpc("muse_task_notes_list", {
    p_key: getExpectedApiKey(), p_message_id: id,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as TaskNote[];
}

export async function ownerTaskReply(ownerKey: string, id: string, text: string): Promise<TaskNote> {
  const { data, error } = await getSupabase().rpc("muse_owner_task_reply", {
    p_owner_key: ownerKey, p_message_id: id, p_text: text,
  });
  if (error) throw new Error(error.message);
  return data as TaskNote;
}

export async function addCalendarTask(eventId: string, title: string, dueAt: string | null, prompt: string | null) {
  const { data, error } = await getSupabase().rpc("muse_add_calendar_task", {
    p_key: getExpectedApiKey(), p_event_id: eventId, p_title: title, p_due_at: dueAt, p_prompt: prompt,
  });
  if (error) throw new Error(error.message);
  return data as { created: boolean; message_id: string };
}
