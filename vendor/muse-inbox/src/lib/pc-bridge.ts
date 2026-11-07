/**
 * Cloud → PC Cua Driver bridge helpers.
 * Forwards authenticated Muse Inbox requests to the Windows PC bridge
 * (Streamable HTTP MCP on PC_BRIDGE_URL, auth PC_BRIDGE_KEY).
 */

export type PcBridgeConfig = {
  url: string;
  key: string;
};

export function getPcBridgeConfig():
  | { ok: true; config: PcBridgeConfig }
  | { ok: false; error: string } {
  const url = (process.env.PC_BRIDGE_URL || "").trim().replace(/\/$/, "");
  const key = (process.env.PC_BRIDGE_KEY || "").trim();
  if (!url) {
    return { ok: false, error: "PC_BRIDGE_URL env var is not set" };
  }
  if (!key) {
    return { ok: false, error: "PC_BRIDGE_KEY env var is not set" };
  }
  return { ok: true, config: { url, key } };
}

export function pcOfflineResponse(detail?: string): Response {
  return Response.json(
    {
      error: "PC offline",
      ...(detail ? { detail } : {}),
    },
    { status: 503 }
  );
}

/** Best-effort online check against the PC bridge /health endpoint. */
export async function checkPcOnline(
  config: PcBridgeConfig,
  timeoutMs = 4000
): Promise<{ online: true; health: unknown } | { online: false; reason: string }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${config.url}/health`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.key}`,
        Accept: "application/json",
      },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        online: false,
        reason: `PC bridge HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
      };
    }
    const health = await res.json().catch(() => ({}));
    return { online: true, health };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { online: false, reason: msg };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Forward a JSON-RPC body (object or batch array) to the PC bridge /mcp endpoint.
 * Returns the raw upstream Response on success, or a synthetic "PC offline" Response.
 */
export async function forwardMcpToPc(
  config: PcBridgeConfig,
  body: unknown,
  init?: {
    accept?: string | null;
    mcpSessionId?: string | null;
    timeoutMs?: number;
  }
): Promise<Response> {
  const timeoutMs = init?.timeoutMs ?? 120_000;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${config.key}`,
      "Content-Type": "application/json",
      Accept: init?.accept || "application/json, text/event-stream",
    };
    if (init?.mcpSessionId) {
      headers["mcp-session-id"] = init.mcpSessionId;
    }

    const upstream = await fetch(`${config.url}/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });

    // Pass through status + body; rewrite only hop-by-hop headers.
    const outHeaders = new Headers();
    const pass = [
      "content-type",
      "mcp-session-id",
      "cache-control",
      "mcp-protocol-version",
    ];
    for (const h of pass) {
      const v = upstream.headers.get(h);
      if (v) outHeaders.set(h, v);
    }
    outHeaders.set("Access-Control-Allow-Origin", "*");
    outHeaders.set(
      "Access-Control-Expose-Headers",
      "mcp-session-id, mcp-protocol-version"
    );

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: outHeaders,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return pcOfflineResponse(msg);
  } finally {
    clearTimeout(t);
  }
}
