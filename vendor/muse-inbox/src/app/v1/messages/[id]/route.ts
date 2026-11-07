import { NextRequest } from "next/server";
import { requireBearerKey } from "@/lib/auth";
import { getMessage, markRead } from "@/lib/messages";
import { buildChatCompletion, queuedReply } from "@/lib/openai-compat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = requireBearerKey(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  try {
    let msg = await getMessage(id);
    // Owner read: only PUBLISHED results get read_at (locks retract/edit).
    if (msg.result_status === "published" && !msg.read_at) {
      msg = await markRead(id);
    }
    if (msg.status === "done") {
      const rs = msg.result_status;
      const content =
        rs === "retracted"
          ? "(Muse hat diese Antwort zurückgezogen.)"
          : rs === "draft"
            ? `[Entwurf – kann von Muse noch geändert/zurückgezogen werden]\n\n${msg.result ?? ""}`
            : msg.result ?? "";
      return Response.json({
        message: msg,
        result_status: rs ?? null,
        chat_completion: buildChatCompletion({ content, model: "muse" }),
      });
    }
    return Response.json({
      message: msg,
      status: "pending",
      chat_completion: buildChatCompletion({
        content: queuedReply(msg.id),
        model: "muse",
      }),
    });
  } catch (e) {
    const err = e instanceof Error ? e.message : "error";
    const status = err.toLowerCase().includes("not found") ? 404 : 500;
    return Response.json({ error: err }, { status });
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, x-api-key",
    },
  });
}
