// Dusty folder fallback (no approval), dry_run only.
const BASE = process.env.BASE, KEY = process.env.MUSE_KEY;
const DUSTY = "1a00e-vC4332HAwmewBnur5L7pQrs_jlB";
const h = { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${KEY}`, "mcp-protocol-version": "2025-06-18" };
async function call(name, args) {
  const r = await fetch(`${BASE}/api/mcp`, { method: "POST", headers: h, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
  const t = await r.text(); const line = t.includes("data:") ? t.split("\n").filter((l) => l.startsWith("data:")).pop().slice(5) : t;
  const m = JSON.parse(line); return { text: (m.result?.content ?? []).map((c) => c.text).join("\n") || m.error?.message, isError: !!m.result?.isError || !!m.error };
}
const mr = await fetch(`${BASE}/api/messages`, { method: "POST", headers: h, body: JSON.stringify({ text: "[Automatischer Test] Erstelle neuen Ordner „Testordner-XYZ“ in Dusty", agent: "test" }) });
const mid = (await mr.json()).message.id;
let ok = 0, bad = 0; const c = (l, x, i) => { x ? ok++ : bad++; console.log(`${x ? "PASS" : "FAIL"} ${l}${x ? "" : " :: " + i}`); };
let r = await call("zapier_google_drive_create_folder", { title: "Testordner-XYZ", parent: DUSTY, message_id: mid, dry_run: true });
c("Dusty folder named in message: allowed without approval (fallback)", !r.isError && /dusty_folder_fallback/.test(r.text), r.text);
r = await call("zapier_google_drive_create_folder", { title: "AndererName", parent: DUSTY, message_id: mid, dry_run: true });
c("Dusty folder with other name: needs approval", r.isError, r.text);
r = await call("zapier_google_drive_delete_file", { file_id: "x", message_id: mid, dry_run: true });
c("delete with message only (no approval): blocked", r.isError, r.text);
await call("mark_done", { id: mid, result: "Automatischer Test – erledigt." });
console.log(`${ok} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
