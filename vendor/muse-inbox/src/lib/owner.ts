import { NextRequest } from "next/server";
import { getExpectedApiKey, timingSafeEqual } from "./auth";

/**
 * Owner credential (separate from Muse's API key). Accepted via
 * `x-owner-key` header or `Authorization: Bearer <owner key>`.
 * The Muse API key is never treated as an owner key. Verification
 * happens in Postgres (sha256 hash in muse_inbox_secrets.owner_key_hash).
 */
export function extractOwnerKey(req: NextRequest): string | null {
  const h = req.headers.get("x-owner-key");
  if (h && h.trim()) return h.trim();
  const auth = req.headers.get("authorization");
  const m = auth?.match(/^Bearer\s+(.+)$/i);
  if (m?.[1]) {
    const v = m[1].trim();
    try {
      if (timingSafeEqual(v, getExpectedApiKey())) return null;
    } catch {
      /* ignore */
    }
    return v;
  }
  return null;
}
