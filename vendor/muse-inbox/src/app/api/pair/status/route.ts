import { NextRequest } from "next/server";
import { sessionCookieHeader } from "@/lib/auth";
import { getPairStatus } from "@/lib/pairings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("t")?.trim();
  if (!token) {
    return Response.json({ error: "t required" }, { status: 400 });
  }
  try {
    const status = await getPairStatus(token);
    if (!status.found) {
      return Response.json({ found: false, status: "unknown" }, { status: 404 });
    }

    const payload = {
      found: true,
      id: status.id,
      status: status.status,
      expires_at: status.expires_at,
      device_label: status.device_label,
      approved_at: status.approved_at,
      claimed: Boolean(status.session_token),
    };

    if (status.session_token) {
      const res = Response.json(payload);
      res.headers.append("Set-Cookie", sessionCookieHeader(status.session_token));
      return res;
    }
    return Response.json(payload);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return Response.json({ error: msg }, { status: 500 });
  }
}
