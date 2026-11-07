import { NextRequest } from "next/server";
import { extractOwnerKey } from "@/lib/owner";
import { decideApproval, httpStatusFor } from "@/lib/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** OWNER ONLY: {decision:'approved'|'denied', note?}. Muse's API key is rejected. */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const ownerKey = extractOwnerKey(req);
  if (!ownerKey) {
    return Response.json({ error: "owner key required (x-owner-key)" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const raw = typeof body.decision === "string" ? body.decision.toLowerCase() : "";
  const decision =
    raw === "approve" || raw === "approved"
      ? "approved"
      : raw === "deny" || raw === "denied"
        ? "denied"
        : null;
  if (!decision) {
    return Response.json({ error: "decision must be approved|denied" }, { status: 400 });
  }
  try {
    const approval = await decideApproval(
      ownerKey,
      id,
      decision,
      typeof body.note === "string" ? body.note : null
    );
    return Response.json({ approval });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return Response.json({ error: msg }, { status: httpStatusFor(msg) });
  }
}
