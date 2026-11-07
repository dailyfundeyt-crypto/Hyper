import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getApproval, httpStatusFor } from "@/lib/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  try {
    return Response.json({ approval: await getApproval(id) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return Response.json({ error: msg }, { status: httpStatusFor(msg) });
  }
}
