import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { httpStatusFor, submitDraft } from "@/lib/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Create/update Muse's answer as a DRAFT (retractable/editable until owner reads it). */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  try {
    const body = await req.json().catch(() => ({}));
    const result =
      typeof body.result === "string"
        ? body.result
        : body.result != null
          ? JSON.stringify(body.result)
          : null;
    const message = await submitDraft(id, result);
    return Response.json({ message });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return Response.json({ error: msg }, { status: httpStatusFor(msg) });
  }
}
