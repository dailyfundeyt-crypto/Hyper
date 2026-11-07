#!/usr/bin/env node
/**
 * Muse PC Bridge — wraps `cua-driver mcp` (stdio) as Streamable HTTP MCP
 * on 127.0.0.1:3420 with Authorization: Bearer <PC_BRIDGE_KEY>.
 *
 * Zero npm dependencies (Node 18+). Designed for Stefan's Windows desktop
 * session. Does not touch OpenBot-v2 / Helium / Connect (port 3101).
 */

"use strict";

const http = require("http");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { timingSafeEqual } = require("crypto");

const HOST = process.env.PC_BRIDGE_HOST || "127.0.0.1";
const PORT = Number(process.env.PC_BRIDGE_PORT || 3420);
const CUA_CMD = process.env.CUA_DRIVER_CMD || "cua-driver";
const CUA_ARGS = (process.env.CUA_DRIVER_ARGS || "mcp").split(/\s+/).filter(Boolean);
const KEY_FILE = process.env.PC_BRIDGE_KEY_FILE || path.join(__dirname, ".pc-key");

/** Load gitignored .env next to this script (KEY=VALUE). Does not override existing env. */
function loadDotEnv() {
  const envPath = path.join(__dirname, ".env");
  let raw;
  try {
    raw = fs.readFileSync(envPath, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const eq = s.indexOf("=");
    if (eq <= 0) continue;
    const k = s.slice(0, eq).trim();
    let v = s.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
loadDotEnv();


function loadKey() {
  if (process.env.PC_BRIDGE_KEY && process.env.PC_BRIDGE_KEY.trim()) {
    return process.env.PC_BRIDGE_KEY.trim();
  }
  try {
    return fs.readFileSync(KEY_FILE, "utf8").trim();
  } catch {
    console.error(
      `[pc-bridge] Missing PC_BRIDGE_KEY. Set env or create ${KEY_FILE}`
    );
    process.exit(1);
  }
}

const BRIDGE_KEY = loadKey();
if (BRIDGE_KEY.length < 16) {
  console.error("[pc-bridge] PC_BRIDGE_KEY too short (need >= 16 chars)");
  process.exit(1);
}

function safeEqualStr(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function extractBearer(req) {
  const auth = req.headers["authorization"];
  if (typeof auth === "string") {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1].trim();
  }
  return null;
}

function requireAuth(req, res) {
  const got = extractBearer(req);
  if (!got || !safeEqualStr(got, BRIDGE_KEY)) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
    return false;
  }
  return true;
}

/** MCP stdio uses Content-Length framed JSON-RPC messages. */
class StdioMcpClient {
  constructor() {
    this.proc = null;
    this.buf = Buffer.alloc(0);
    this.pending = new Map(); // id -> { resolve, reject, timer }
    this.nextLocalId = 1;
    this.stderrTail = [];
    this.alive = false;
    this.starting = null;
  }

  async ensure() {
    if (this.alive && this.proc && !this.proc.killed) return;
    if (this.starting) return this.starting;
    this.starting = this._start();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  _start() {
    return new Promise((resolve, reject) => {
      console.log(`[pc-bridge] spawning: ${CUA_CMD} ${CUA_ARGS.join(" ")}`);
      const proc = spawn(CUA_CMD, CUA_ARGS, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
        windowsHide: true,
        shell: false,
      });
      this.proc = proc;
      this.buf = Buffer.alloc(0);
      this.alive = false;

      let settled = false;
      const fail = (err) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
        this._failAll(err);
        this.alive = false;
      };

      proc.on("error", (err) => {
        console.error("[pc-bridge] cua-driver spawn error:", err.message);
        fail(err);
      });

      proc.on("exit", (code, signal) => {
        console.error(
          `[pc-bridge] cua-driver exited code=${code} signal=${signal}`
        );
        fail(new Error(`cua-driver exited (code=${code}, signal=${signal})`));
      });

      proc.stderr.on("data", (chunk) => {
        const s = chunk.toString("utf8");
        this.stderrTail.push(s);
        if (this.stderrTail.length > 40) this.stderrTail.shift();
        process.stderr.write(`[cua-driver] ${s}`);
      });

      proc.stdout.on("data", (chunk) => this._onStdout(chunk));

      // Give the process a moment; mark alive once stdin is writable.
      const readyCheck = () => {
        if (settled) return;
        if (proc.killed) {
          fail(new Error("cua-driver died before ready"));
          return;
        }
        this.alive = true;
        settled = true;
        resolve();
      };
      // On Windows spawn is sync-ish; next tick is enough.
      setImmediate(readyCheck);
    });
  }

  _onStdout(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (true) {
      const headerEnd = this.buf.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        // Also accept bare newline-delimited JSON (some clients).
        const nl = this.buf.indexOf("\n");
        if (nl !== -1 && this.buf[0] === 0x7b /* { */) {
          const line = this.buf.slice(0, nl).toString("utf8").trim();
          this.buf = this.buf.slice(nl + 1);
          if (line) this._dispatchMessage(line);
          continue;
        }
        break;
      }
      const header = this.buf.slice(0, headerEnd).toString("utf8");
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        // Skip malformed header line
        this.buf = this.buf.slice(headerEnd + 4);
        continue;
      }
      const len = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (this.buf.length < bodyStart + len) break;
      const body = this.buf.slice(bodyStart, bodyStart + len).toString("utf8");
      this.buf = this.buf.slice(bodyStart + len);
      this._dispatchMessage(body);
    }
  }

  _dispatchMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      console.error("[pc-bridge] bad JSON from cua-driver:", e.message);
      return;
    }
    // Notifications (no id) — ignore for request/response bridge.
    if (msg.id === undefined || msg.id === null) {
      return;
    }
    const pending = this.pending.get(String(msg.id));
    if (!pending) {
      console.warn("[pc-bridge] unexpected response id", msg.id);
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(String(msg.id));
    pending.resolve(msg);
  }

  _failAll(err) {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  _write(msg) {
    const json = JSON.stringify(msg);
    const frame = `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`;
    if (!this.proc || !this.proc.stdin.writable) {
      throw new Error("cua-driver stdin not writable");
    }
    this.proc.stdin.write(frame);
  }

  /**
   * Send one JSON-RPC request (or notification). For requests, wait for matching id.
   * Rewrites numeric/string ids to local unique ids to avoid collisions across HTTP clients.
   */
  async request(msg, timeoutMs = 120000) {
    await this.ensure();

    // Notification — fire and forget
    if (msg.id === undefined) {
      this._write(msg);
      return null;
    }

    const originalId = msg.id;
    const localId = `b${this.nextLocalId++}`;
    const outbound = { ...msg, id: localId, jsonrpc: msg.jsonrpc || "2.0" };

    const response = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(localId);
        reject(new Error(`cua-driver timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(localId, { resolve, reject, timer });
      try {
        this._write(outbound);
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(localId);
        reject(e);
      }
    });

    // Restore caller's id
    return { ...response, id: originalId };
  }

  async requestBatch(messages, timeoutMs = 120000) {
    const out = [];
    for (const m of messages) {
      const r = await this.request(m, timeoutMs);
      if (r !== null) out.push(r);
    }
    return out;
  }

  health() {
    return {
      bridge: "ok",
      cuaAlive: !!(this.alive && this.proc && !this.proc.killed),
      cuaCmd: `${CUA_CMD} ${CUA_ARGS.join(" ")}`,
      pending: this.pending.size,
      stderrTail: this.stderrTail.slice(-5).join("").slice(-500),
    };
  }

  stop() {
    this._failAll(new Error("bridge stopping"));
    if (this.proc && !this.proc.killed) {
      try {
        this.proc.stdin.end();
      } catch {
        /* ignore */
      }
      try {
        this.proc.kill();
      } catch {
        /* ignore */
      }
    }
    this.alive = false;
  }
}

const cua = new StdioMcpClient();

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "mcp-session-id",
    "mcp-session-id": "pc-bridge",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, Accept, mcp-session-id",
    });
    res.end();
    return;
  }

  // Health is auth-gated so random localhost scanners don't leak process state.
  if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
    if (!requireAuth(req, res)) return;
    sendJson(res, 200, {
      ok: true,
      service: "muse-pc-bridge",
      port: PORT,
      ...cua.health(),
    });
    return;
  }

  if (url.pathname === "/mcp") {
    if (!requireAuth(req, res)) return;

    if (req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
        "mcp-session-id": "pc-bridge",
      });
      res.write(": pc-bridge mcp ready\n\n");
      res.end();
      return;
    }

    if (req.method === "POST") {
      let raw;
      try {
        raw = await readBody(req);
      } catch (e) {
        sendJson(res, 400, {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        });
        return;
      }

      let body;
      try {
        body = JSON.parse(raw || "null");
      } catch {
        sendJson(res, 400, {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        });
        return;
      }

      try {
        if (Array.isArray(body)) {
          const responses = await cua.requestBatch(body);
          if (responses.length === 0) {
            res.writeHead(202, { "Access-Control-Allow-Origin": "*" });
            res.end();
            return;
          }
          sendJson(res, 200, responses);
          return;
        }

        const response = await cua.request(body);
        if (response === null) {
          res.writeHead(202, { "Access-Control-Allow-Origin": "*" });
          res.end();
          return;
        }
        sendJson(res, 200, response);
        return;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[pc-bridge] MCP forward error:", msg);
        // Distinct from auth errors: upstream Cua / process failure
        sendJson(res, 503, {
          error: "PC offline",
          detail: msg,
          stderr: cua.health().stderrTail || undefined,
        });
        return;
      }
    }
  }

  sendJson(res, 404, { error: "not found" });
});

server.listen(PORT, HOST, () => {
  console.log(
    `[pc-bridge] Streamable HTTP MCP on http://${HOST}:${PORT}/mcp (Bearer required)`
  );
  console.log(`[pc-bridge] health: http://${HOST}:${PORT}/health`);
  console.log(`[pc-bridge] cua: ${CUA_CMD} ${CUA_ARGS.join(" ")}`);
  // Eager-start cua-driver so /health reflects readiness sooner.
  cua.ensure().catch((e) => {
    console.error(
      "[pc-bridge] cua-driver not started yet:",
      e instanceof Error ? e.message : e
    );
    console.error(
      "[pc-bridge] Install with: irm https://cua.ai/driver/install.ps1 | iex"
    );
  });
});

function shutdown() {
  console.log("[pc-bridge] shutting down");
  cua.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 3000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
