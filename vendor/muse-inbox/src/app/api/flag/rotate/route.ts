import { NextRequest } from "next/server";
import { extractOwnerKey } from "@/lib/owner";
import { httpStatusFor, rotateFlagToken } from "@/lib/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** OWNER ONLY: create/rotate the public hook flag token. Old URL stops working immediately. */
export async function POST(req: NextRequest) {
  const ownerKey = extractOwnerKey(req);
  if (!ownerKey) return Response.json({ error: "owner key required (x-owner-key)" }, { status: 403 });
  try {
    const token = await rotateFlagToken(ownerKey);
    const url = `${req.nextUrl.origin}/api/flag/${token}`;
    return Response.json({ url }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return Response.json({ error: msg }, { status: httpStatusFor(msg) });
  }
}
