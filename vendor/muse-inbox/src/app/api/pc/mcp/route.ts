import { NextRequest } from "next/server";
import { requireBearerKey } from "@/lib/auth";
import {
  checkPcOnline,
  forwardMcpToPc,
  getPcBridgeConfig,
  pcOfflineResponse,
} from "@/lib/pc-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Long-running Cua actions (browser navigate, screenshots) need headroom. */
export const maxDuration = 120;

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, Accept, Mcp-Session-Id, MCP-Protocol-Version, X-Api-Key, Last-Event-ID",
    "Access-Control-Expose-Headers": "mcp-session-id, mcp-protocol-version",
  };
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

/**
 * GET /api/pc/mcp — lightweight readiness (SSE keepalive) after Muse API key auth.
 * Does a short PC health ping so clients learn "PC offline" early.
 */
export async function GET(req: NextRequest) {
  const auth = requireBearerKey(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
    });
  }

  const cfg = getPcBridgeConfig();
  if (!cfg.ok) {
    return pcOfflineResponse(cfg.error);
  }

  const ping = await checkPcOnline(cfg.config, 3000);
  if (!ping.online) {
    return pcOfflineResponse(ping.reason);
  }

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(enc.encode(": muse-pc-bridge mcp ready\n\n"));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      ...corsHeaders(),
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

/**
 * POST /api/pc/mcp — Streamable HTTP MCP proxy to Stefan's PC Cua Driver bridge.
 * Auth: Muse Inbox API_KEY (Bearer / ?key=). Upstream: PC_BRIDGE_URL + PC_BRIDGE_KEY.
 */
export async function POST(req: NextRequest) {
  const auth = requireBearerKey(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
    });
  }

  const cfg = getPcBridgeConfig();
  if (!cfg.ok) {
    return pcOfflineResponse(cfg.error);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400, headers: corsHeaders() }
    );
  }

  const upstream = await forwardMcpToPc(cfg.config, body, {
    accept: req.headers.get("accept"),
    mcpSessionId: req.headers.get("mcp-session-id"),
  });

  // Ensure CORS on every response (including PC offline).
  const headers = new Headers(upstream.headers);
  for (const [k, v] of Object.entries(corsHeaders())) {
    headers.set(k, v);
  }
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}
