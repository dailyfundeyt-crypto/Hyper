import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { httpStatusFor, editResult } from "@/lib/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  try {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const body = await req.json().catch(() => ({}));
    const message = await editResult(id, typeof body.result === "string" ? body.result : body.result != null ? JSON.stringify(body.result) : null);
    return Response.json({ message });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return Response.json({ error: msg }, { status: httpStatusFor(msg) });
  }
}
