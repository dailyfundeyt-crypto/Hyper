import { NextRequest } from "next/server";
import {
  clearLegacyCookieHeader,
  clearSessionCookieHeader,
  getExpectedApiKey,
  sessionCookieHeader,
  timingSafeEqual,
} from "@/lib/auth";
import { createLoginSession } from "@/lib/pairings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const passcode = typeof body.passcode === "string" ? body.passcode : "";
    const expected = getExpectedApiKey();
    if (!timingSafeEqual(passcode, expected)) {
      return Response.json({ error: "Falscher Code" }, { status: 401 });
    }
    const deviceLabel =
      typeof body.device_label === "string" ? body.device_label.slice(0, 80) : "web";
    const sessionToken = await createLoginSession(deviceLabel);
    const res = Response.json({ ok: true });
    res.headers.append("Set-Cookie", sessionCookieHeader(sessionToken));
    res.headers.append("Set-Cookie", clearLegacyCookieHeader());
    return res;
  } catch {
    return Response.json({ error: "server error" }, { status: 500 });
  }
}

export async function DELETE() {
  const res = Response.json({ ok: true });
  res.headers.append("Set-Cookie", clearSessionCookieHeader());
  res.headers.append("Set-Cookie", clearLegacyCookieHeader());
  return res;
}
