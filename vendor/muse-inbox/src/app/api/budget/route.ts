import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { extractOwnerKey } from "@/lib/owner";
import { getBudget, httpStatusFor } from "@/lib/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Current month (Europe/Berlin): budget, spent, remaining. Muse key or owner key. */
export async function GET(req: NextRequest) {
  const ownerKey = extractOwnerKey(req);
  try {
    if (ownerKey) return Response.json(await getBudget(ownerKey));
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;
    return Response.json(await getBudget());
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return Response.json({ error: msg }, { status: httpStatusFor(msg) });
  }
}
