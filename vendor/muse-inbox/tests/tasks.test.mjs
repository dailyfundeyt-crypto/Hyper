// Task queue: list_open_tasks + complete_task (creates one muse task and completes it at once).
const BASE = process.env.BASE, KEY = process.env.MUSE_KEY;
const h = { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${KEY}`, "mcp-protocol-version": "2025-06-18" };
async function call(name, args = {}) {
  const r = await fetch(`${BASE}/api/mcp`, { method: "POST", headers: h, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
  const t = await r.text(); const line = t.includes("data:") ? t.split("\n").filter((l) => l.startsWith("data:")).pop().slice(5) : t;
  const m = JSON.parse(line); const text = (m.result?.content ?? []).map((c) => c.text).join("\n") || m.error?.message;
  return { text, isError: !!m.result?.isError || !!m.error };
}
let ok = 0, bad = 0; const c = (l, x, i) => { x ? ok++ : bad++; console.log(`${x ? "PASS" : "FAIL"} ${l}${x ? "" : " :: " + String(i).slice(0, 300)}`); };
const tl = await fetch(`${BASE}/api/mcp`, { method: "POST", headers: h, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }).then((r) => r.text());
c("tools/list has list_open_tasks + complete_task", tl.includes("list_open_tasks") && tl.includes("complete_task"), "");
const mr = await fetch(`${BASE}/api/messages`, { method: "POST", headers: h, body: JSON.stringify({ text: "[Automatischer Test] Aufgabe – bitte ignorieren, wird sofort abgeschlossen" }) });
const mid = (await mr.json()).message.id;
let r = await call("list_open_tasks"); const d = JSON.parse(r.text);
const all = d.days.flatMap((g) => g.tasks);
c("new owner message appears as open task", all.some((t) => t.message_id === mid), r.text);
c("oldest first", all.every((t, i) => i === 0 || all[i - 1].created_at <= t.created_at), "order");
c("grouped by day", d.days.every((g) => /^\d{4}-\d{2}-\d{2}$/.test(g.day)), JSON.stringify(d.days.map((g) => g.day)));
r = await call("complete_task", { message_id: mid, result_note: "Automatischer Test – erledigt." });
c("complete_task ok", !r.isError && JSON.parse(r.text).status === "done", r.text);
r = await call("list_open_tasks");
c("completed task gone from open list", !JSON.parse(r.text).days.flatMap((g) => g.tasks).some((t) => t.message_id === mid), r.text);
console.log(`${ok} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
