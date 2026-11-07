// Harmless mock of a Zapier MCP server: never touches real Drive. Records calls.
import http from "node:http";
const calls = [];
const tools = [
  { name: "google_drive_find_file", description: "Find a file", inputSchema: { type: "object", properties: { query: { type: "string" } } } },
  { name: "google_drive_create_folder", description: "Create folder", inputSchema: { type: "object", properties: { title: { type: "string" }, parent: { type: "string" } } } },
  { name: "google_drive_delete_file", description: "Delete file", inputSchema: { type: "object", properties: { file_id: { type: "string" } } } },
  { name: "google_drive_move_file", description: "Move file", inputSchema: { type: "object", properties: { file_id: { type: "string" }, folder: { type: "string" } } } },
];
http.createServer((req, res) => {
  if (req.url === "/calls") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify(calls)); }
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    const m = JSON.parse(b || "{}");
    if (m.id === undefined) { res.statusCode = 202; return res.end(); }
    let result = {};
    if (m.method === "initialize") result = { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "mock-zapier", version: "0" } };
    else if (m.method === "tools/list") result = { tools };
    else if (m.method === "tools/call") { calls.push(m.params); result = { content: [{ type: "text", text: `MOCK OK ${m.params.name}` }] }; }
    res.setHeader("content-type", "application/json"); res.setHeader("mcp-session-id", "mock");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: m.id, result }));
  });
}).listen(4599, () => console.log("mock zapier on 4599"));
