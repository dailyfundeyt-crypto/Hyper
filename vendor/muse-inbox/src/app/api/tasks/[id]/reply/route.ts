import { NextRequest } from "next/server";
import { extractOwnerKey } from "@/lib/owner";
import { httpStatusFor, ownerTaskReply } from "@/lib/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** OWNER ONLY: Stefan answers in a task thread. Clears 'waiting', reopens the task (flag A). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const ownerKey = extractOwnerKey(req);
  if (!ownerKey) return Response.json({ error: "owner key required (x-owner-key)" }, { status: 403 });
  const { id } = await ctx.params;
  let text = "";
  try {
    const body = await req.json();
    text = typeof body?.text === "string" ? body.text : "";
  } catch {
    /* empty */
  }
  if (!text.trim()) return Response.json({ error: "text required" }, { status: 400 });
  try {
    return Response.json({ note: await ownerTaskReply(ownerKey, id, text) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return Response.json({ error: msg }, { status: httpStatusFor(msg) });
  }
}
