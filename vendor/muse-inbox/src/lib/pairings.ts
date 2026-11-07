import { getSupabase } from "./supabase";
import { getExpectedApiKey } from "./auth";
import { pairingToken, randomToken, sha256Hex } from "./crypto";

export type PairStatus = "pending" | "approved" | "expired";

export type PairStatusResult = {
  found: boolean;
  id?: string;
  status?: PairStatus;
  expires_at?: string;
  device_label?: string | null;
  approved_at?: string | null;
  session_token?: string | null;
};

export async function createPairing(deviceLabel?: string | null) {
  const token = pairingToken();
  const tokenHash = sha256Hex(token);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("muse_pair_create", {
    p_key: getExpectedApiKey(),
    p_token_hash: tokenHash,
    p_expires_at: expiresAt,
    p_device_label: deviceLabel ?? null,
  });
  if (error) throw new Error(error.message);
  const row = data as { id: string; expires_at: string; status: string };
  return {
    id: row.id,
    token,
    expires_at: row.expires_at ?? expiresAt,
    status: row.status as PairStatus,
  };
}

export async function getPairStatus(token: string): Promise<PairStatusResult> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("muse_pair_status", {
    p_token_hash: sha256Hex(token),
  });
  if (error) throw new Error(error.message);
  return (data ?? { found: false }) as PairStatusResult;
}

export async function approvePairing(
  token: string,
  deviceLabel?: string | null
): Promise<{ sessionToken: string; id: string; status: string; device_label?: string | null }> {
  const sessionToken = randomToken(32);
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("muse_pair_approve", {
    p_key: getExpectedApiKey(),
    p_token_hash: sha256Hex(token),
    p_session_token: sessionToken,
    p_session_token_hash: sha256Hex(sessionToken),
    p_device_label: deviceLabel ?? null,
  });
  if (error) throw new Error(error.message);
  const row = data as { id: string; status: string; device_label?: string | null };
  return {
    sessionToken,
    id: row.id,
    status: row.status,
    device_label: row.device_label,
  };
}

export async function createLoginSession(deviceLabel = "web"): Promise<string> {
  const sessionToken = randomToken(32);
  const supabase = getSupabase();
  const { error } = await supabase.rpc("muse_session_create", {
    p_key: getExpectedApiKey(),
    p_session_token: sessionToken,
    p_session_token_hash: sha256Hex(sessionToken),
    p_device_label: deviceLabel,
  });
  if (error) throw new Error(error.message);
  return sessionToken;
}
