import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { httpStatusFor } from "@/lib/messages";
import { dueSummaries } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "Bereit für deinen Termin" cards: auto-generated at the deadline (or when all tasks are done). */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  try {
    return Response.json({ summaries: await dueSummaries() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return Response.json({ error: msg }, { status: httpStatusFor(msg) });
  }
}
