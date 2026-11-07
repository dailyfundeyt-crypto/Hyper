import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { listAgents } from "@/lib/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  try {
    const agents = await listAgents();
    return Response.json({ agents });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return Response.json({ error: msg }, { status: 500 });
  }
}
