// Integration test for the inbox-order approval rule in the Zapier proxy.
// Usage: BASE=http://localhost:3005 MUSE_KEY=… OWNER_KEY=… MODE=local|remote node tests/approval-flow.test.mjs
// MODE=remote never forwards anything (dry_run only). Test message uses agent "test" (does not wake Muse).
const BASE = process.env.BASE, KEY = process.env.MUSE_KEY, OWNER = process.env.OWNER_KEY, MODE = process.env.MODE || "remote";
const LOCKED_SHEET = "1WXIW7s2OSQtrDkAm8W4PuEnNRUma83tOnMsq2q13o6M";
const LEGACY = "1O_pLPesENoD_W10oixYtJYoUVcAMkQ1Z";
let sid = null, n = 1, pass = 0, fail = 0;
async function mcp(method, params) {
  const h = { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${KEY}`, "mcp-protocol-version": "2025-06-18" };
  if (sid) h["mcp-session-id"] = sid;
  const r = await fetch(`${BASE}/api/mcp`, { method: "POST", headers: h, body: JSON.stringify({ jsonrpc: "2.0", id: n++, method, params }) });
  sid = r.headers.get("mcp-session-id") || sid;
  const t = await r.text();
  const line = t.includes("data:") ? t.split("\n").filter((l) => l.startsWith("data:")).pop().slice(5) : t;
  return JSON.parse(line);
}
async function call(name, args) {
  const m = await mcp("tools/call", { name, arguments: args });
  if (m.error) return { text: `RPCERR ${m.error.message}`, isError: true };
  return { text: (m.result?.content ?? []).map((c) => c.text).join("\n"), isError: !!m.result?.isError };
}
function check(label, cond, info = "") { if (cond) { pass++; console.log(`PASS ${label}`); } else { fail++; console.log(`FAIL ${label} :: ${info.slice(0, 300)}`); } }
async function approval(mid, action, summary, details) {
  const r = await call("request_approval", { message_id: mid, action, summary, details });
  return JSON.parse(r.text).approval;
}
async function decide(id, decision) {
  const r = await fetch(`${BASE}/api/approvals/${id}/decide`, { method: "POST", headers: { "content-type": "application/json", "x-owner-key": OWNER }, body: JSON.stringify({ decision }) });
  return { status: r.status, body: await r.json() };
}

await mcp("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "approval-test", version: "1" } });
const tl = await mcp("tools/list", {});
const names = (tl.result?.tools ?? []).map((t) => t.name);
check("tools/list has list_approvals", names.includes("list_approvals"));
const ra = (tl.result?.tools ?? []).find((t) => t.name === "request_approval");
check("request_approval description explains inbox flow", /Ja\/Nein/.test(ra?.description ?? "") && /approval_id/.test(ra?.description ?? ""));

// test message (agent=test, does not trigger Muse heartbeat)
const mr = await fetch(`${BASE}/api/messages`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` }, body: JSON.stringify({ text: "[Automatischer Test] Bitte Testdatei TEST-123 löschen (Mock, nichts Echtes).", agent: "test" }) });
const msg = (await mr.json()).message;
check("test inbox message created", !!msg?.id);
const mid = msg.id;
const FILE = "TEST-FILE-DOES-NOT-EXIST-123";

if (MODE === "local") {
  const r = await call("zapier_google_drive_find_file", { query: "x" });
  check("read action free (forwarded)", !r.isError && /MOCK OK/.test(r.text), r.text);
}
let r = await call("zapier_google_drive_delete_file", { file_id: FILE, dry_run: true });
check("delete without approval blocked", r.isError && /approval_id/.test(r.text), r.text);

const ap = await approval(mid, "google_drive.delete", "Testdatei löschen (Mock)", { tool: "google_drive_delete_file", file_id: FILE });
check("approval created pending + linked", ap?.status === "pending" && ap?.message_id === mid);
r = await call("zapier_google_drive_delete_file", { file_id: FILE, message_id: mid, approval_id: ap.id, dry_run: true });
check("pending approval blocked", r.isError && /nicht erteilt/.test(r.text), r.text);

const muse403 = await fetch(`${BASE}/api/approvals/${ap.id}/decide`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` }, body: JSON.stringify({ decision: "approved" }) });
check("Muse key cannot approve", muse403.status === 403 || muse403.status === 401, String(muse403.status));
const d = await decide(ap.id, "approved");
check("owner approves", d.status === 200 && d.body.approval?.status === "approved", JSON.stringify(d.body));
r = await call("get_approval", { id: ap.id });
check("get_approval shows approved", JSON.parse(r.text).approval.status === "approved");
r = await call("list_approvals", { status: "approved" });
check("list_approvals contains it", JSON.parse(r.text).approvals.some((a) => a.id === ap.id));

r = await call("zapier_google_drive_delete_file", { file_id: FILE, message_id: "00000000-0000-0000-0000-000000000000", approval_id: ap.id, dry_run: true });
check("wrong message_id blocked", r.isError && /message_id/.test(r.text), r.text);
r = await call("zapier_google_drive_delete_file", { file_id: FILE, approval_id: ap.id, dry_run: true });
check("missing message_id blocked", r.isError, r.text);
r = await call("zapier_google_drive_delete_file", { file_id: FILE, message_id: mid, approval_id: ap.id, dry_run: true });
check("dry_run with message_id+approval_id OK", !r.isError && /dry_run/.test(r.text), r.text);
r = await call("get_approval", { id: ap.id });
check("dry_run does not consume", !JSON.parse(r.text).approval.used_at);

if (MODE === "local") {
  r = await call("zapier_google_drive_delete_file", { file_id: FILE, message_id: mid, approval_id: ap.id });
  check("approved delete executed (mock)", !r.isError && /MOCK OK/.test(r.text), r.text);
  r = await call("get_approval", { id: ap.id });
  check("approval marked used_at", !!JSON.parse(r.text).approval.used_at);
  r = await call("zapier_google_drive_delete_file", { file_id: FILE, message_id: mid, approval_id: ap.id });
  check("re-use blocked", r.isError && /verwendet|already used/.test(r.text), r.text);
}

// locked IDs / legacy
const ap2 = await approval(mid, "google_sheets.update", "Zeile ändern (Test)", { spreadsheet_id: LOCKED_SHEET, row: "0999" });
await decide(ap2.id, "approved");
r = await call("zapier_google_sheets_update_row", { spreadsheet: LOCKED_SHEET, product_id: "0528", message_id: mid, approval_id: ap2.id, dry_run: true });
check("locked ID 0528 blocked when not named", r.isError && /0528/.test(r.text), r.text);
const ap3 = await approval(mid, "google_sheets.update", "0528 ändern (Test)", { spreadsheet_id: LOCKED_SHEET, product_id: "0528" });
await decide(ap3.id, "approved");
r = await call("zapier_google_sheets_update_row", { spreadsheet: LOCKED_SHEET, product_id: "0528", message_id: mid, approval_id: ap3.id, dry_run: true });
check("locked ID allowed when named in details", !r.isError, r.text);
r = await call("zapier_google_drive_move_file", { file_id: LEGACY, message_id: mid, approval_id: ap2.id, dry_run: true });
check("legacy Store-5 ID blocked when not named", r.isError && /1O_pL/.test(r.text), r.text);

// purchase needs purchase approval
r = await call("zapier_execute_zapier_write_action", { action: "purchase item", message_id: mid, approval_id: ap2.id, dry_run: true });
check("purchase with non-purchase approval blocked", r.isError && /purchase/.test(r.text), r.text);

// denied
const ap4 = await approval(mid, "google_drive.create_folder", "Ordner (Test, wird abgelehnt)", { title: "X" });
await decide(ap4.id, "denied");
r = await call("zapier_google_drive_create_folder", { title: "X", message_id: mid, approval_id: ap4.id, dry_run: true });
check("denied approval blocked", r.isError && /denied/.test(r.text), r.text);

// cleanup: consume nothing else; close test message
await call("mark_done", { id: mid, result: "Automatischer Test – erledigt (nichts Echtes ausgeführt)." });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
