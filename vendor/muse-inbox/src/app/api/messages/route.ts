import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createMessage, getControl, listMessages } from "@/lib/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const status = req.nextUrl.searchParams.get("status") ?? "new";
  try {
    const control = await getControl();
    if (control.paused && status === "new") {
      return Response.json({
        messages: [],
        paused: true,
        notice: "Muse ist pausiert (Stopp-Wort STOPP). Keine Aufgaben bearbeiten, bis der Owner fortsetzt.",
      });
    }
    const messages = await listMessages(status);
    return Response.json({ messages, paused: control.paused });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return Response.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  try {
    const body = await req.json().catch(() => ({}));
    const text = typeof body.text === "string" ? body.text : "";
    const agent =
      typeof body.agent === "string" && body.agent.trim()
        ? body.agent.trim().toLowerCase()
        : "muse";
    if (!text.trim()) {
      return Response.json({ error: "text required" }, { status: 400 });
    }
    const message = await createMessage(text, agent);
    return Response.json({ message }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return Response.json({ error: msg }, { status: 500 });
  }
}
