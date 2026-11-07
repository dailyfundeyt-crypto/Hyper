import { NextRequest } from "next/server";
import { flagByToken } from "@/lib/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const H = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
};

/** Public hook flag: no auth, unguessable token in the path. Returns ONLY {"flag":"A"|"B"}. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  try {
    const flag = token && token.length >= 32 && token.length <= 128 ? await flagByToken(token) : null;
    if (!flag) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: H });
    return new Response(JSON.stringify({ flag }), { status: 200, headers: H });
  } catch {
    return new Response(JSON.stringify({ error: "unavailable" }), { status: 503, headers: H });
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" },
  });
}
