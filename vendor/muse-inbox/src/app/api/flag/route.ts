import { NextRequest } from "next/server";
import { requireBearerKey } from "@/lib/auth";
import { hasNewMessages } from "@/lib/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ultra token-efficient heartbeat: body is exactly "A" or "B". */
export async function GET(req: NextRequest) {
  const auth = requireBearerKey(req);
  if (!auth.ok) return auth.response;
  try {
    const has = await hasNewMessages();
    return new Response(has ? "A" : "B", {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return Response.json({ error: msg }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers":
        "Authorization, Content-Type, x-api-key",
    },
  });
}
