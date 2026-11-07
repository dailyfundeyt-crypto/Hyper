import { NextRequest } from "next/server";
import {
  getExpectedApiKey,
  sessionCookieHeader,
  timingSafeEqual,
} from "@/lib/auth";
import { approvePairing } from "@/lib/pairings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const token = typeof body.token === "string" ? body.token.trim() : "";
    const passcode = typeof body.passcode === "string" ? body.passcode : "";
    const deviceLabel =
      typeof body.device_label === "string" ? body.device_label.slice(0, 80) : "phone";

    if (!token) {
      return Response.json({ error: "token required" }, { status: 400 });
    }

    const expected = getExpectedApiKey();
    if (!timingSafeEqual(passcode, expected)) {
      return Response.json({ error: "Falscher Zugangscode" }, { status: 401 });
    }

    const result = await approvePairing(token, deviceLabel);
    const res = Response.json({
      ok: true,
      id: result.id,
      status: result.status,
      device_label: result.device_label,
      redirect: "/chat",
    });
    res.headers.append("Set-Cookie", sessionCookieHeader(result.sessionToken));
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    let status = 500;
    if (msg.includes("not found")) status = 404;
    else if (msg.includes("expired")) status = 410;
    else if (msg.includes("not pending")) status = 409;
    else if (msg.includes("unauthorized")) status = 401;
    return Response.json({ error: msg }, { status });
  }
}
