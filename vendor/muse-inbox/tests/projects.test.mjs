// Project docs + calendar activation + links + summary. Creates a uniquely named test doc; completes all its tasks at the end.
const BASE = process.env.BASE, KEY = process.env.MUSE_KEY, OWNER = process.env.OWNER_KEY;
const h = { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${KEY}`, "mcp-protocol-version": "2025-06-18" };
async function call(name, args = {}) {
  const r = await fetch(`${BASE}/api/mcp`, { method: "POST", headers: h, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
  const t = await r.text(); const line = t.includes("data:") ? t.split("\n").filter((l) => l.startsWith("data:")).pop().slice(5) : t;
  const m = JSON.parse(line); const text = (m.result?.content ?? []).map((c) => c.text).join("\n") || m.error?.message;
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { text, json, isError: !!m.result?.isError || !!m.error };
}
let ok = 0, bad = 0; const c = (l, x, i) => { x ? ok++ : bad++; console.log(`${x ? "PASS" : "FAIL"} ${l}${x ? "" : " :: " + String(i).slice(0, 400)}`); };
const R = Math.random().toString(36).slice(2, 8);
const NAME = `ZZ Testprojekt ${R}`;
const DOC = "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUv/edit";
const FOLDER = "https://drive.google.com/drive/folders/1FoLdEr_xyz-123";
const BODY = `Ziel: automatischer Test\n- Doc lesen ${DOC}\n- Ordner prüfen ${FOLDER} und https://example.com/a.\n- [x] schon erledigt\n`;

const tl = await fetch(`${BASE}/api/mcp`, { method: "POST", headers: h, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }).then((r) => r.text());
for (const t of ["get_task", "list_projects", "get_project", "activate_project_from_calendar", "post_project_summary"]) c(`tools/list has ${t}`, tl.includes(`"${t}"`), "");

// owner save
let r0 = await fetch(`${BASE}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: NAME, body: BODY }) });
c("save without owner key -> 403", r0.status === 403, r0.status);
r0 = await fetch(`${BASE}/api/projects`, { method: "POST", headers: { "content-type": "application/json", "x-owner-key": "wrong-" + R }, body: JSON.stringify({ name: NAME, body: BODY }) });
c("save with wrong owner key rejected", r0.status === 403 || r0.status === 401, r0.status);
r0 = await fetch(`${BASE}/api/projects`, { method: "POST", headers: { "content-type": "application/json", "x-owner-key": OWNER }, body: JSON.stringify({ name: NAME, body: BODY, always_active: false }) });
const saved = await r0.json(); const PID = saved.project?.id;
c("owner creates doc", r0.ok && !!PID, JSON.stringify(saved));
c("doc has shareable /projekte url", saved.project?.url?.endsWith(`/projekte/${PID}`), saved.project?.url);

// UI GET routes with Muse key
const g = await fetch(`${BASE}/api/projects/${PID}`, { headers: h }).then((r) => r.json());
c("GET /api/projects/[id]: 2 doc tasks ([x] skipped)", g.project?.doc_tasks?.length === 2, JSON.stringify(g.project?.doc_tasks));
const kinds = (g.project?.attachments ?? []).map((a) => a.kind).sort().join(",");
c("doc links parsed (doc, drive_folder, web)", kinds === "doc,drive_folder,web", kinds);
const docA = (g.project?.attachments ?? []).find((a) => a.kind === "doc");
c("drive_id extracted from Doc link", docA?.drive_id === "1AbCdEfGhIjKlMnOpQrStUv", JSON.stringify(docA));
const webA = (g.project?.attachments ?? []).find((a) => a.kind === "web");
c("trailing punctuation stripped", webA?.url === "https://example.com/a", webA?.url);
const lp = await call("list_projects");
c("list_projects contains doc, inactive", lp.json?.some?.((p) => p.id === PID && p.active_today === false) ?? JSON.stringify(lp.json).includes(PID), lp.text);

// activation
const future = new Date(Date.now() + 3 * 3600_000).toISOString();
let r = await call("activate_project_from_calendar", { event_id: `test-${R}-1`, project_name_or_id: NAME, due_at: future });
c("activate exact name", r.json?.matched && r.json?.activated && r.json?.tasks?.length === 2, r.text);
c("future deadline -> work_now false", r.json?.work_now === false, r.text);
const t1 = r.json?.tasks?.[0];
c("activated task carries doc link attachment", (t1?.attachments ?? []).some((a) => a.kind === "doc" && a.drive_id), JSON.stringify(t1));
r = await call("activate_project_from_calendar", { event_id: `test-${R}-1`, project_name_or_id: NAME, due_at: future });
c("same event_id deduped", r.json?.matched && r.json?.deduped === true && r.json?.tasks?.length === 2, r.text);
const past = new Date(Date.now() - 600_000).toISOString();
r = await call("activate_project_from_calendar", { event_id: `test-${R}-2`, project_name_or_id: `Dusty: zz testprojekt ${R}`, due_at: past });
c("fuzzy name (Dusty: prefix, case) matches", r.json?.matched && r.json?.project?.id === PID, r.text);
c("past start -> work_now true", r.json?.work_now === true, r.text);
const ACT2 = r.json?.activation_id;
const soon = new Date(Date.now() + 10 * 60_000).toISOString();
r = await call("activate_project_from_calendar", { event_id: `test-${R}-3`, project_name_or_id: `Termin – siehe https://prototyping-muse.vercel.app/projekte/${PID}`, due_at: soon });
c("inbox link matches + <15 min -> work_now", r.json?.matched && r.json?.project?.id === PID && r.json?.work_now === true, r.text);
r = await call("activate_project_from_calendar", { event_id: `test-${R}-4`, project_name_or_id: `Gibt es nicht ${R} qqq`, due_at: future });
c("unmatched -> matched=false + fallback hint", r.json?.matched === false && r.text.includes("add_task_from_calendar"), r.text);

// queue
r = await call("list_open_tasks");
const all = (r.json?.days ?? []).flatMap((d) => d.tasks);
const mine = all.filter((t) => t.project_id === PID);
c("materialized tasks in list_open_tasks (3 activations x 2)", mine.length === 6, mine.length);
c("tasks have project_url + link attachments", mine.every((t) => t.project_url?.includes(PID)) && mine.some((t) => t.attachments?.some((a) => a.kind === "drive_folder")), JSON.stringify(mine[0]));
c("projects_today lists doc with activations", (r.json?.projects_today ?? []).some((p) => (p.project_id ?? p.id) === PID && p.activations?.length >= 3), JSON.stringify(r.json?.projects_today).slice(0, 300));
const gt = await call("get_task", { message_id: mine[0].message_id });
c("get_task returns attachments", gt.json?.attachments?.length >= 1, gt.text);

// summary
r = await call("post_project_summary", { project_id: PID, activation_id: ACT2 });
c("post_project_summary: total 2, open 2", r.json?.total === 2 && r.json?.done === 0 && r.json?.all_done === false, r.text);
let s = await fetch(`${BASE}/api/projects/summaries`, { headers: h }).then((x) => x.json());
c("summary card shown after deadline even if open", (s.summaries ?? []).some((x) => x.activation_id === ACT2), JSON.stringify(s).slice(0, 300));
for (const t of mine) await call("complete_task", { message_id: t.message_id, result_note: `Automatischer Test erledigt – Ergebnis ${DOC}` });
r = await call("post_project_summary", { project_id: PID, activation_id: ACT2 });
c("after completing: all_done + results with links", r.json?.all_done === true && r.json?.results?.length === 2 && r.json.results.some((x) => x.attachments?.some((a) => a.kind === "doc")), r.text);
s = await fetch(`${BASE}/api/projects/summaries`, { headers: h }).then((x) => x.json());
c("future-deadline activation shows card once all done", (s.summaries ?? []).filter((x) => x.project_id === PID).length === 3, (s.summaries ?? []).filter((x) => x.project_id === PID).length);

// always active
r0 = await fetch(`${BASE}/api/projects`, { method: "POST", headers: { "content-type": "application/json", "x-owner-key": OWNER }, body: JSON.stringify({ id: PID, name: NAME, body: BODY, always_active: true }) });
c("toggle immer aktiv", r0.ok && (await r0.json()).project?.always_active === true, r0.status);
r = await call("list_open_tasks");
const alw = (r.json?.days ?? []).flatMap((d) => d.tasks).filter((t) => t.project_id === PID);
c("immer aktiv -> tasks materialized without calendar", alw.length === 2, alw.length);
const pt = (r.json?.projects_today ?? []).find((p) => (p.project_id ?? p.id) === PID);
c("always activation listed with source=always", pt?.activations?.some((a) => a.source === "always"), String(JSON.stringify(pt)).slice(0, 300));
r = await call("list_open_tasks");
c("always activation idempotent", (r.json?.days ?? []).flatMap((d) => d.tasks).filter((t) => t.project_id === PID).length === 2, "dup");
for (const t of alw) await call("complete_task", { message_id: t.message_id, result_note: "Automatischer Test erledigt." });
await fetch(`${BASE}/api/projects`, { method: "POST", headers: { "content-type": "application/json", "x-owner-key": OWNER }, body: JSON.stringify({ id: PID, name: NAME, body: BODY, always_active: false }) });
console.log(`TEST_PROJECT_ID=${PID}`);
console.log(`${ok} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
