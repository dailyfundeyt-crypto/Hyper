import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { httpStatusFor, listOpenTasks } from "@/lib/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Open owner tasks, oldest first, grouped by day (session cookie or Muse key). */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  try {
    return Response.json(await listOpenTasks());
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return Response.json({ error: msg }, { status: httpStatusFor(msg) });
  }
}
