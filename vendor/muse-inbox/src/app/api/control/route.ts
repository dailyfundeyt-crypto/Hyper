import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { extractOwnerKey } from "@/lib/owner";
import { checkOwnerKey, getControl, httpStatusFor, resumeMuse, stopMuse } from "@/lib/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorize(req: NextRequest): Promise<{ owner: string | null } | Response> {
  const ownerKey = extractOwnerKey(req);
  if (ownerKey && (await checkOwnerKey(ownerKey))) return { owner: ownerKey };
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  return { owner: null };
}

export async function GET(req: NextRequest) {
  const a = await authorize(req);
  if (a instanceof Response) return a;
  try {
    return Response.json(await getControl());
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return Response.json({ error: msg }, { status: httpStatusFor(msg) });
  }
}

/** {action:'stop'} — Muse key or owner key. {action:'resume'} — owner key only. */
export async function POST(req: NextRequest) {
  const a = await authorize(req);
  if (a instanceof Response) return a;
  const body = await req.json().catch(() => ({}));
  const action = typeof body.action === "string" ? body.action.toLowerCase() : "";
  try {
    if (action === "stop") {
      return Response.json(await stopMuse(a.owner ? "owner" : "api"));
    }
    if (action === "resume") {
      if (!a.owner) {
        return Response.json(
          { error: "resume requires owner key (x-owner-key)" },
          { status: 403 }
        );
      }
      return Response.json(await resumeMuse(a.owner));
    }
    return Response.json({ error: "action must be 'stop' or 'resume'" }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return Response.json({ error: msg }, { status: httpStatusFor(msg) });
  }
}
