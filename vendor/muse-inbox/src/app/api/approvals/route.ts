import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { extractOwnerKey } from "@/lib/owner";
import { httpStatusFor, listApprovals, requestApproval } from "@/lib/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** List approvals. Owner key (x-owner-key) or Muse API key. ?status=pending|approved|denied| (empty=all) */
export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status") ?? "pending";
  const ownerKey = extractOwnerKey(req);
  try {
    if (ownerKey) {
      return Response.json({ approvals: await listApprovals(status, ownerKey) });
    }
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;
    return Response.json({ approvals: await listApprovals(status) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return Response.json({ error: msg }, { status: httpStatusFor(msg) });
  }
}

/** Muse requests owner approval: {message_id?, action, summary, details} */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  try {
    const approval = await requestApproval({
      message_id: typeof body.message_id === "string" ? body.message_id : null,
      action: typeof body.action === "string" ? body.action : "",
      summary: typeof body.summary === "string" ? body.summary : "",
      details: body.details,
    });
    return Response.json({ approval }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return Response.json({ error: msg }, { status: httpStatusFor(msg) });
  }
}
