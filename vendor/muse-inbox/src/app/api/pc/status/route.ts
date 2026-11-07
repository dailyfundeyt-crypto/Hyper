import { NextRequest } from "next/server";
import { requireBearerKey } from "@/lib/auth";
import { checkPcOnline, getPcBridgeConfig } from "@/lib/pc-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
  };
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

/** GET /api/pc/status — online check for Stefan's Windows PC Cua bridge. */
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
    return Response.json(
      { online: false, error: "PC offline", detail: cfg.error },
      { status: 503, headers: corsHeaders() }
    );
  }

  const result = await checkPcOnline(cfg.config);
  if (!result.online) {
    return Response.json(
      { online: false, error: "PC offline", detail: result.reason },
      { status: 503, headers: corsHeaders() }
    );
  }

  return Response.json(
    { online: true, health: result.health },
    { headers: corsHeaders() }
  );
}
