import { NextRequest } from "next/server";
import { requireBearerKey } from "@/lib/auth";
import { createMessage, waitForResult } from "@/lib/messages";
import {
  buildChatCompletion,
  chatCompletionId,
  parseChatMessages,
  queuedReply,
  sseChunk,
  type ChatMessage,
} from "@/lib/openai-compat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Stay under Vercel function limit; poll ~50s */
export const maxDuration = 60;

const WAIT_MS = 50_000;
const POLL_MS = 2_000;

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, x-api-key",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(req: NextRequest) {
  const auth = requireBearerKey(req);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400, headers: corsHeaders });
  }

  const messages = body.messages as ChatMessage[] | undefined;
  const stream = Boolean(body.stream);
  const model =
    typeof body.model === "string" && body.model.trim() ? body.model.trim() : "muse";

  let parsed;
  try {
    parsed = await parseChatMessages(Array.isArray(messages) ? messages : []);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "bad request";
    return Response.json({ error: msg }, { status: 400, headers: corsHeaders });
  }

  let createdMsg;
  try {
    createdMsg = await createMessage(parsed.storedText, "muse", {
      source: "api",
      attachments: parsed.attachments,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return Response.json({ error: msg }, { status: 500, headers: corsHeaders });
  }

  const completionId = chatCompletionId();
  const created = Math.floor(Date.now() / 1000);

  if (stream) {
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        const send = (s: string) => controller.enqueue(encoder.encode(s));
        try {
          send(sseChunk({ id: completionId, created, model, content: "" }));
          const started = Date.now();
          let done = false;
          while (Date.now() - started < WAIT_MS) {
            send(`: keepalive ${Date.now()}\n\n`);
            const remaining = WAIT_MS - (Date.now() - started);
            if (remaining <= 0) break;
            await new Promise((r) =>
              setTimeout(r, Math.min(POLL_MS, remaining))
            );
            try {
              const { getMessage } = await import("@/lib/messages");
              const msg = await getMessage(createdMsg.id);
              if (msg.status === "done") {
                const content = msg.result ?? "";
                send(
                  sseChunk({
                    id: completionId,
                    created,
                    model,
                    content,
                  })
                );
                send(
                  sseChunk({
                    id: completionId,
                    created,
                    model,
                    finish: true,
                  })
                );
                send("data: [DONE]\n\n");
                done = true;
                break;
              }
            } catch (e) {
              console.error("poll failed", e);
            }
          }
          if (!done) {
            const content = queuedReply(createdMsg.id);
            send(
              sseChunk({ id: completionId, created, model, content })
            );
            send(
              sseChunk({ id: completionId, created, model, finish: true })
            );
            send("data: [DONE]\n\n");
          }
        } catch (e) {
          console.error("stream error", e);
          send(
            `data: ${JSON.stringify({ error: e instanceof Error ? e.message : "error" })}\n\n`
          );
          send("data: [DONE]\n\n");
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  try {
    const answered = await waitForResult(createdMsg.id, WAIT_MS, POLL_MS);
    const content = answered?.result
      ? answered.result
      : queuedReply(createdMsg.id);
    return Response.json(
      buildChatCompletion({
        id: completionId,
        created,
        model,
        content,
      }),
      { headers: corsHeaders }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return Response.json({ error: msg }, { status: 500, headers: corsHeaders });
  }
}
