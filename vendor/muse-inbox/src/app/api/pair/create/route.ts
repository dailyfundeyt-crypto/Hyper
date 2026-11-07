import { NextRequest } from "next/server";
import { getPublicBaseUrl } from "@/lib/auth";
import { createPairing } from "@/lib/pairings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const deviceLabel =
      typeof body.device_label === "string" ? body.device_label.slice(0, 80) : "desktop";
    const pairing = await createPairing(deviceLabel);
    const approveUrl = `${getPublicBaseUrl()}/pair/approve?t=${encodeURIComponent(pairing.token)}`;
    return Response.json({
      id: pairing.id,
      token: pairing.token,
      expires_at: pairing.expires_at,
      status: pairing.status,
      approve_url: approveUrl,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return Response.json({ error: msg }, { status: 500 });
  }
}
