import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { httpStatusFor, listTaskNotes } from "@/lib/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Task-thread notes (last 30 days, or ?message_id=). Session cookie or Muse key. */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  try {
    const id = req.nextUrl.searchParams.get("message_id");
    return Response.json({ notes: await listTaskNotes(id || null) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return Response.json({ error: msg }, { status: httpStatusFor(msg) });
  }
}
