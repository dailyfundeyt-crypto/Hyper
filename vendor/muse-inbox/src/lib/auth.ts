import { NextRequest } from "next/server";
import { getSupabase } from "./supabase";
import { sha256Hex } from "./crypto";

export const SESSION_COOKIE = "muse_session";
export const LEGACY_AUTH_COOKIE = "muse_inbox_auth";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export function getExpectedApiKey(): string {
  const key = process.env.API_KEY;
  if (!key) throw new Error("API_KEY env var is not set");
  return key;
}

export function getPublicBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, "") ||
    "https://prototyping-muse.vercel.app"
  );
}

/** Accept Authorization: Bearer <key>, ?key=, or x-api-key header */
export function extractApiKey(req: NextRequest): string | null {
  const auth = req.headers.get("authorization");
  if (auth) {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m?.[1]) return m[1].trim();
  }
  const headerKey = req.headers.get("x-api-key");
  if (headerKey) return headerKey.trim();
  const q = req.nextUrl.searchParams.get("key");
  if (q) return q.trim();
  return null;
}

export function extractSessionToken(req: NextRequest): string | null {
  const raw = req.cookies.get(SESSION_COOKIE)?.value;
  if (raw) return decodeURIComponent(raw);
  return null;
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

/** Extra HTTP keys (API_KEY_AGENT / API_KEY_AGENTS) authenticate like API_KEY.
 *  RPCs still use getExpectedApiKey() (the master env key). Pairing stays master-only.
 */
export function getAcceptedHttpApiKeys(): string[] {
  const keys: string[] = [];
  const add = (value?: string) => {
    const trimmed = value?.trim();
    if (trimmed) keys.push(trimmed);
  };
  add(process.env.API_KEY);
  add(process.env.API_KEY_AGENT);
  const extras = process.env.API_KEY_AGENTS;
  if (extras) {
    for (const part of extras.split(/[,\n]/)) add(part);
  }
  return keys;
}

export function httpApiKeyAccepted(got: string): boolean {
  let ok = false;
  for (const key of getAcceptedHttpApiKeys()) {
    if (key.length === got.length && timingSafeEqual(got, key)) ok = true;
  }
  return ok;
}

async function sessionValid(token: string): Promise<boolean> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("muse_session_valid", {
    p_session_token_hash: sha256Hex(token),
  });
  if (error) {
    console.error("muse_session_valid", error.message);
    return false;
  }
  return data === true;
}

/** MCP / legacy: Bearer, x-api-key, or ?key= only (no session cookie). Sync. */
export function requireBearerKey(
  req: NextRequest
): { ok: true } | { ok: false; response: Response } {
  try {
    getExpectedApiKey();
    const got = extractApiKey(req);
    if (!got || !httpApiKeyAccepted(got)) {
      return {
        ok: false,
        response: Response.json({ error: "unauthorized" }, { status: 401 }),
      };
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      response: Response.json({ error: "server misconfigured" }, { status: 500 }),
    };
  }
}

/**
 * Auth: Bearer/?key/x-api-key OR muse_session cookie OR legacy muse_inbox_auth cookie.
 * MCP should keep using Bearer/?key/x-api-key (unchanged).
 */
export async function requireAuth(
  req: NextRequest
): Promise<{ ok: true } | { ok: false; response: Response }> {
  try {
    const expected = getExpectedApiKey();
    const got = extractApiKey(req);
    if (got && httpApiKeyAccepted(got)) {
      return { ok: true };
    }

    const session = extractSessionToken(req);
    if (session && (await sessionValid(session))) {
      return { ok: true };
    }

    const legacy = req.cookies.get(LEGACY_AUTH_COOKIE)?.value;
    if (legacy) {
      const decoded = decodeURIComponent(legacy);
      if (timingSafeEqual(decoded, expected)) {
        return { ok: true };
      }
    }

    return {
      ok: false,
      response: Response.json({ error: "unauthorized" }, { status: 401 }),
    };
  } catch {
    return {
      ok: false,
      response: Response.json({ error: "server misconfigured" }, { status: 500 }),
    };
  }
}

/** Back-compat alias used by existing routes */
export async function requireApiKey(
  req: NextRequest
): Promise<{ ok: true } | { ok: false; response: Response }> {
  return requireAuth(req);
}

export function sessionCookieHeader(token: string, maxAge = SESSION_MAX_AGE): string {
  const secure = process.env.NODE_ENV === "production" || process.env.VERCEL ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function clearLegacyCookieHeader(): string {
  return `${LEGACY_AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
