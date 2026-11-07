// Project docs (Projekte): calendar activation, materialized tasks, summary cards.
import { getSupabase } from "./supabase";
import { getExpectedApiKey, getPublicBaseUrl } from "./auth";
import { parseLinks } from "./links";

export const projectUrl = (id: string) => `${getPublicBaseUrl()}/projekte/${id}`;

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

type Json = Record<string, unknown>;
type ProjTask = { text?: string; result?: string | null } & Json;

function withLinksTasks(tasks: unknown): unknown {
  if (!Array.isArray(tasks)) return tasks;
  return (tasks as ProjTask[]).map((t) => ({
    ...t,
    attachments: [...parseLinks(t.text ?? ""), ...parseLinks(t.result ?? "")],
  }));
}

function decorateProject<T extends Json>(p: T): T {
  const out: Json = { ...p };
  if (typeof p.id === "string") out.url = projectUrl(p.id);
  if (typeof p.body === "string") out.attachments = parseLinks(p.body);
  if (Array.isArray(p.activations))
    out.activations = (p.activations as Json[]).map((a) => (a.tasks ? { ...a, tasks: withLinksTasks(a.tasks) } : a));
  return out as T;
}

export async function listProjects() {
  const list = await rpc<Json[]>("muse_projects_list", { p_key: getExpectedApiKey() });
  return (list ?? []).map(decorateProject);
}

export async function getProject(ref: string) {
  return decorateProject(await rpc<Json>("muse_project_get", { p_key: getExpectedApiKey(), p_ref: ref }));
}

export async function ensureAlwaysActiveToday(): Promise<number> {
  return rpc<number>("muse_projects_ensure_today", { p_key: getExpectedApiKey() });
}

export async function activateProjectFromCalendar(eventId: string, ref: string, dueAt: string | null) {
  const r = await rpc<Json>("muse_activate_project", {
    p_key: getExpectedApiKey(), p_event_id: eventId, p_ref: ref, p_due_at: dueAt,
  });
  if (!r?.matched) return r;
  const proj = r.project as Json | undefined;
  return { ...r, project: proj ? { ...proj, url: projectUrl(String(proj.id)) } : proj, tasks: withLinksTasks(r.tasks) };
}

export type ProjectSummary = Json & {
  project_id: string; project_name: string; activation_id: string; due_at: string | null;
  total: number; done: number; all_done: boolean;
};

function decorateSummary(s: Json): ProjectSummary {
  const results = Array.isArray(s.results)
    ? (s.results as ProjTask[]).map((x) => ({ ...x, attachments: [...parseLinks(x.result ?? ""), ...parseLinks(x.text ?? "")] }))
    : s.results;
  return { ...s, results, url: projectUrl(String(s.project_id)) } as unknown as ProjectSummary;
}

export async function projectSummary(ref: string | null, activationId: string | null, post = false) {
  return decorateSummary(
    await rpc<Json>("muse_project_summary", {
      p_key: getExpectedApiKey(), p_ref: ref, p_activation_id: activationId, p_post: post,
    })
  );
}

/** Summary cards due now: activations of the last 2 days whose deadline passed, or (no/near deadline) all done. */
export async function dueSummaries(): Promise<ProjectSummary[]> {
  const projects = await listProjects();
  const now = Date.now();
  const cutoff = new Date(now - 2 * 86400_000).toISOString().slice(0, 10);
  const out: ProjectSummary[] = [];
  for (const p of projects) {
    for (const a of (p.activations as Json[]) ?? []) {
      if (String(a.active_on) < cutoff) continue;
      const s = await projectSummary(null, String(a.activation_id));
      if (!s.total) continue;
      const due = s.due_at ? Date.parse(String(s.due_at)) : null;
      if ((due !== null && due <= now) || s.all_done) out.push(s);
    }
  }
  return out.sort((x, y) => String(y.due_at ?? "").localeCompare(String(x.due_at ?? "")));
}

/** OWNER ONLY: create (id null) or update a doc. */
export async function ownerSaveProject(ownerKey: string, input: { id?: string | null; name: string; body: string; always_active?: boolean | null }) {
  const p = await rpc<Json>("muse_owner_project_save", {
    p_owner_key: ownerKey, p_id: input.id ?? null, p_name: input.name, p_body: input.body, p_always_active: input.always_active ?? null,
  });
  return decorateProject(p);
}
