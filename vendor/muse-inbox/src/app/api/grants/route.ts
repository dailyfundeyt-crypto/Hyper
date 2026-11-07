import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { extractOwnerKey } from "@/lib/owner";
import { addGrant, httpStatusFor, listGrants, revokeGrant } from "@/lib/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Muse key: active grants. Owner key: all grants (incl. revoked/expired). */
export async function GET(req: NextRequest) {
  const ownerKey = extractOwnerKey(req);
  try {
    if (ownerKey) return Response.json({ grants: await listGrants(ownerKey) });
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;
    return Response.json({
      grants: await listGrants(),
      note: "Nur diese Aktionen sind vorab freigegeben (Scope beachten). Alles andere: request_approval.",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return Response.json({ error: msg }, { status: httpStatusFor(msg) });
  }
}

/** OWNER ONLY. {action, scope, description, expires_at?} or {revoke: id} */
export async function POST(req: NextRequest) {
  const ownerKey = extractOwnerKey(req);
  if (!ownerKey) {
    return Response.json({ error: "owner key required (x-owner-key)" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  try {
    if (typeof body.revoke === "string") {
      return Response.json({ grant: await revokeGrant(ownerKey, body.revoke) });
    }
    const grant = await addGrant(ownerKey, {
      action: typeof body.action === "string" ? body.action : "",
      scope: body.scope,
      description: typeof body.description === "string" ? body.description : "",
      expires_at: typeof body.expires_at === "string" ? body.expires_at : null,
    });
    return Response.json({ grant }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return Response.json({ error: msg }, { status: httpStatusFor(msg) });
  }
}
