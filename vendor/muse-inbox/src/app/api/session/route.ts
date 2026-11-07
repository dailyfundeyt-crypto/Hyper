import { NextRequest } from "next/server";
import {
  clearLegacyCookieHeader,
  clearSessionCookieHeader,
  requireAuth,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return Response.json({ ok: false }, { status: 401 });
  return Response.json({ ok: true });
}

export async function DELETE() {
  const res = Response.json({ ok: true });
  res.headers.append("Set-Cookie", clearSessionCookieHeader());
  res.headers.append("Set-Cookie", clearLegacyCookieHeader());
  return res;
}
