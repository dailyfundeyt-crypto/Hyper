import { createClient, SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY must be set");
  }
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export type MuseAttachment = {
  id: string;
  path: string;
  filename: string;
  mime: string | null;
  size: number | null;
  kind: string;
  /** Signed URL (7d) — filled when listing for Muse */
  url?: string;
};

export type MuseMessage = {
  id: string;
  text: string;
  status: "new" | "done";
  result: string | null;
  created_at: string;
  done_at: string | null;
  agent?: string;
  source?: string | null;
  attachments?: MuseAttachment[] | null;
  project_id?: string | null;
  activation_id?: string | null;
  project_task_index?: number | null;
  result_status?: "draft" | "published" | "retracted" | null;
  result_history?: unknown[];
  published_at?: string | null;
  read_at?: string | null;
  task_state?: "waiting" | null;
  calendar_event_id?: string | null;
  due_at?: string | null;
};

export type MuseApproval = {
  id: string;
  created_at: string;
  message_id: string | null;
  action: string;
  summary: string;
  details: Record<string, unknown>;
  status: "pending" | "approved" | "denied";
  decided_at: string | null;
  decision_note: string | null;
  used_at?: string | null;
  used_for?: string | null;
};

export type MuseControl = {
  paused: boolean;
  updated_at: string | null;
  updated_by: string | null;
  stop_word: string;
};

export type MuseFile = {
  id: string;
  path: string;
  filename: string;
  mime: string | null;
  size: number | null;
  kind: string;
  created_at: string;
};

export type MuseAgent = {
  id: string;
  name: string;
  status: "active" | "recent" | "idle";
  last_activity: string | null;
};

export const ATTACHMENTS_BUCKET = "muse-attachments";
export const SIGNED_URL_TTL_SEC = 60 * 60 * 24 * 7; // 7 days
