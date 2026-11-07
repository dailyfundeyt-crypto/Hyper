-- Additive: draft/retract/publish results, kill switch, owner approvals
ALTER TABLE public.muse_inbox_messages
  ADD COLUMN IF NOT EXISTS result_status text,
  ADD COLUMN IF NOT EXISTS result_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS read_at timestamptz;
DO $$ BEGIN
  ALTER TABLE public.muse_inbox_messages
    ADD CONSTRAINT muse_inbox_messages_result_status_chk
    CHECK (result_status IS NULL OR result_status IN ('draft','published','retracted'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.muse_inbox_secrets ADD COLUMN IF NOT EXISTS owner_key_hash text;

CREATE TABLE IF NOT EXISTS public.muse_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);
ALTER TABLE public.muse_settings ENABLE ROW LEVEL SECURITY;
INSERT INTO public.muse_settings (key, value, updated_by)
VALUES ('paused', 'false'::jsonb, 'migration') ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.muse_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  message_id uuid REFERENCES public.muse_inbox_messages(id) ON DELETE SET NULL,
  action text NOT NULL,
  summary text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
  decided_at timestamptz,
  decision_note text
);
ALTER TABLE public.muse_approvals ENABLE ROW LEVEL SECURITY;

-- helpers
CREATE OR REPLACE FUNCTION public._muse_is_paused() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE((SELECT value = 'true'::jsonb FROM public.muse_settings WHERE key='paused'), false);
$$;

CREATE OR REPLACE FUNCTION public._muse_check_owner(p_owner_key text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE h text;
BEGIN
  SELECT owner_key_hash INTO h FROM public.muse_inbox_secrets WHERE id = 1;
  IF h IS NULL OR p_owner_key IS NULL OR length(p_owner_key) < 32
     OR encode(sha256(convert_to(p_owner_key, 'UTF8')), 'hex') IS DISTINCT FROM h THEN
    RAISE EXCEPTION 'owner unauthorized' USING ERRCODE = '42501';
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.muse_check_owner(p_owner_key text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public._muse_check_owner(p_owner_key);
  RETURN true;
EXCEPTION WHEN insufficient_privilege THEN RETURN false;
END; $$;

CREATE OR REPLACE FUNCTION public._muse_hist(p_row public.muse_inbox_messages, p_action text, p_extra jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(p_row.result_history, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object('at', now(), 'action', p_action,
      'prev_status', p_row.result_status, 'prev_result', p_row.result) || COALESCE(p_extra,'{}'::jsonb));
$$;

-- control
CREATE OR REPLACE FUNCTION public.muse_get_control(p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s public.muse_settings;
BEGIN
  PERFORM public._muse_check_key(p_key);
  SELECT * INTO s FROM public.muse_settings WHERE key='paused';
  RETURN jsonb_build_object('paused', COALESCE(s.value = 'true'::jsonb, false),
    'updated_at', s.updated_at, 'updated_by', s.updated_by, 'stop_word', 'STOPP');
END; $$;

CREATE OR REPLACE FUNCTION public.muse_set_paused(p_key text, p_paused boolean, p_by text DEFAULT 'api') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public._muse_check_key(p_key);
  IF p_paused IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'resume requires owner key' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.muse_settings (key, value, updated_at, updated_by)
  VALUES ('paused', to_jsonb(COALESCE(p_paused,false)), now(), p_by)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by;
  RETURN public.muse_get_control(p_key);
END; $$;

-- create with stop word
CREATE OR REPLACE FUNCTION public.muse_create_message(p_key text, p_text text, p_agent text DEFAULT 'muse'::text, p_source text DEFAULT NULL::text, p_attachments jsonb DEFAULT '[]'::jsonb)
 RETURNS muse_inbox_messages LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  row public.muse_inbox_messages; ag text; src text; att jsonb;
BEGIN
  PERFORM public._muse_check_key(p_key);
  IF p_text IS NULL OR length(trim(p_text)) = 0 THEN
    RAISE EXCEPTION 'text required' USING ERRCODE = '22023';
  END IF;
  ag := lower(trim(COALESCE(NULLIF(p_agent, ''), 'muse')));
  IF length(ag) = 0 THEN ag := 'muse'; END IF;
  src := NULLIF(trim(COALESCE(p_source, '')), '');
  att := COALESCE(p_attachments, '[]'::jsonb);
  IF jsonb_typeof(att) <> 'array' THEN att := '[]'::jsonb; END IF;
  IF trim(p_text) = 'STOPP' THEN
    PERFORM public.muse_set_paused(p_key, true, 'stop_word');
    INSERT INTO public.muse_inbox_messages (text, agent, source, attachments, status, done_at, result)
    VALUES ('STOPP', ag, src, att, 'done', now(), 'Stopp-Wort erkannt: Muse ist pausiert.')
    RETURNING * INTO row;
    RETURN row;
  END IF;
  INSERT INTO public.muse_inbox_messages (text, agent, source, attachments)
  VALUES (trim(p_text), ag, src, att)
  RETURNING * INTO row;
  RETURN row;
END; $function$;

-- older overloads delegate (so stop word applies everywhere)
CREATE OR REPLACE FUNCTION public.muse_create_message(p_key text, p_text text)
 RETURNS muse_inbox_messages LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.muse_create_message(p_key, p_text, 'muse'::text, NULL::text, '[]'::jsonb);
$$;
CREATE OR REPLACE FUNCTION public.muse_create_message(p_key text, p_text text, p_agent text DEFAULT 'muse'::text)
 RETURNS muse_inbox_messages LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.muse_create_message(p_key, p_text, p_agent, NULL::text, '[]'::jsonb);
$$;

CREATE OR REPLACE FUNCTION public.muse_has_new(p_key text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE found boolean;
BEGIN
  PERFORM public._muse_check_key(p_key);
  IF public._muse_is_paused() THEN RETURN false; END IF;
  SELECT EXISTS (SELECT 1 FROM public.muse_inbox_messages m
    WHERE m.status = 'new' AND (m.agent IS NULL OR m.agent = 'muse') LIMIT 1) INTO found;
  RETURN COALESCE(found, false);
END; $function$;

-- results
CREATE OR REPLACE FUNCTION public.muse_submit_draft(p_key text, p_id uuid, p_result text)
RETURNS muse_inbox_messages LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE row public.muse_inbox_messages;
BEGIN
  PERFORM public._muse_check_key(p_key);
  IF public._muse_is_paused() THEN RAISE EXCEPTION 'paused: Muse ist pausiert (STOPP)' USING ERRCODE = '55000'; END IF;
  SELECT * INTO row FROM public.muse_inbox_messages WHERE id = p_id FOR UPDATE;
  IF row.id IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  IF row.read_at IS NOT NULL THEN RAISE EXCEPTION 'locked: result already read by owner' USING ERRCODE = '55000'; END IF;
  UPDATE public.muse_inbox_messages SET
    result_history = public._muse_hist(row, 'submit_draft', jsonb_build_object('new_result', p_result)),
    status = 'done', done_at = now(), result = p_result,
    result_status = 'draft', published_at = NULL
  WHERE id = p_id RETURNING * INTO row;
  RETURN row;
END; $$;

CREATE OR REPLACE FUNCTION public.muse_mark_done(p_key text, p_id uuid, p_result text DEFAULT NULL::text)
RETURNS muse_inbox_messages LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  RETURN public.muse_submit_draft(p_key, p_id, p_result);
END; $$;

CREATE OR REPLACE FUNCTION public.muse_edit_result(p_key text, p_id uuid, p_result text)
RETURNS muse_inbox_messages LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE row public.muse_inbox_messages;
BEGIN
  PERFORM public._muse_check_key(p_key);
  IF public._muse_is_paused() THEN RAISE EXCEPTION 'paused: Muse ist pausiert (STOPP)' USING ERRCODE = '55000'; END IF;
  SELECT * INTO row FROM public.muse_inbox_messages WHERE id = p_id FOR UPDATE;
  IF row.id IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  IF row.read_at IS NOT NULL THEN RAISE EXCEPTION 'locked: result already read by owner' USING ERRCODE = '55000'; END IF;
  IF row.result_status IS NULL THEN RAISE EXCEPTION 'no result to edit (use submit_draft)' USING ERRCODE = '55000'; END IF;
  UPDATE public.muse_inbox_messages SET
    result_history = public._muse_hist(row, 'edit', jsonb_build_object('new_result', p_result)),
    result = p_result,
    result_status = CASE WHEN row.result_status = 'retracted' THEN 'draft' ELSE row.result_status END
  WHERE id = p_id RETURNING * INTO row;
  RETURN row;
END; $$;

CREATE OR REPLACE FUNCTION public.muse_retract_result(p_key text, p_id uuid, p_reason text DEFAULT NULL)
RETURNS muse_inbox_messages LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE row public.muse_inbox_messages;
BEGIN
  PERFORM public._muse_check_key(p_key);
  SELECT * INTO row FROM public.muse_inbox_messages WHERE id = p_id FOR UPDATE;
  IF row.id IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  IF row.read_at IS NOT NULL THEN RAISE EXCEPTION 'locked: result already read by owner' USING ERRCODE = '55000'; END IF;
  IF row.result_status IS NULL OR row.result_status = 'retracted' THEN
    RAISE EXCEPTION 'nothing to retract' USING ERRCODE = '55000'; END IF;
  UPDATE public.muse_inbox_messages SET
    result_history = public._muse_hist(row, 'retract', jsonb_build_object('reason', p_reason)),
    result = NULL, result_status = 'retracted', published_at = NULL
  WHERE id = p_id RETURNING * INTO row;
  RETURN row;
END; $$;

CREATE OR REPLACE FUNCTION public.muse_publish_result(p_key text, p_id uuid)
RETURNS muse_inbox_messages LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE row public.muse_inbox_messages;
BEGIN
  PERFORM public._muse_check_key(p_key);
  IF public._muse_is_paused() THEN RAISE EXCEPTION 'paused: Muse ist pausiert (STOPP)' USING ERRCODE = '55000'; END IF;
  SELECT * INTO row FROM public.muse_inbox_messages WHERE id = p_id FOR UPDATE;
  IF row.id IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  IF row.read_at IS NOT NULL THEN RAISE EXCEPTION 'locked: result already read by owner' USING ERRCODE = '55000'; END IF;
  IF row.result_status IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'only drafts can be published' USING ERRCODE = '55000'; END IF;
  UPDATE public.muse_inbox_messages SET
    result_history = public._muse_hist(row, 'publish'),
    result_status = 'published', published_at = now()
  WHERE id = p_id RETURNING * INTO row;
  RETURN row;
END; $$;

CREATE OR REPLACE FUNCTION public.muse_mark_read(p_key text, p_id uuid)
RETURNS muse_inbox_messages LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE row public.muse_inbox_messages;
BEGIN
  PERFORM public._muse_check_key(p_key);
  UPDATE public.muse_inbox_messages SET read_at = now()
  WHERE id = p_id AND result_status = 'published' AND read_at IS NULL;
  SELECT * INTO row FROM public.muse_inbox_messages WHERE id = p_id;
  IF row.id IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  RETURN row;
END; $$;

-- approvals
CREATE OR REPLACE FUNCTION public.muse_request_approval(p_key text, p_message_id uuid, p_action text, p_summary text, p_details jsonb DEFAULT '{}'::jsonb)
RETURNS muse_approvals LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE row public.muse_approvals;
BEGIN
  PERFORM public._muse_check_key(p_key);
  IF public._muse_is_paused() THEN RAISE EXCEPTION 'paused: Muse ist pausiert (STOPP)' USING ERRCODE = '55000'; END IF;
  IF p_action IS NULL OR length(trim(p_action)) = 0 THEN RAISE EXCEPTION 'action required' USING ERRCODE = '22023'; END IF;
  IF p_summary IS NULL OR length(trim(p_summary)) = 0 THEN RAISE EXCEPTION 'summary required' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.muse_approvals (message_id, action, summary, details)
  VALUES (p_message_id, trim(p_action), trim(p_summary), COALESCE(p_details, '{}'::jsonb))
  RETURNING * INTO row;
  RETURN row;
END; $$;

CREATE OR REPLACE FUNCTION public.muse_get_approval(p_key text, p_id uuid)
RETURNS muse_approvals LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE row public.muse_approvals;
BEGIN
  PERFORM public._muse_check_key(p_key);
  SELECT * INTO row FROM public.muse_approvals WHERE id = p_id;
  IF row.id IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  RETURN row;
END; $$;

CREATE OR REPLACE FUNCTION public.muse_list_approvals(p_key text, p_status text DEFAULT 'pending')
RETURNS SETOF muse_approvals LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public._muse_check_key(p_key);
  RETURN QUERY SELECT a.* FROM public.muse_approvals a
    WHERE (p_status IS NULL OR p_status = '' OR a.status = p_status)
    ORDER BY a.created_at DESC LIMIT 200;
END; $$;

CREATE OR REPLACE FUNCTION public.muse_owner_list_approvals(p_owner_key text, p_status text DEFAULT 'pending')
RETURNS SETOF muse_approvals LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public._muse_check_owner(p_owner_key);
  RETURN QUERY SELECT a.* FROM public.muse_approvals a
    WHERE (p_status IS NULL OR p_status = '' OR a.status = p_status)
    ORDER BY a.created_at DESC LIMIT 200;
END; $$;

-- owner only (owner key, NOT the Muse API key)
CREATE OR REPLACE FUNCTION public.muse_decide_approval(p_owner_key text, p_id uuid, p_decision text, p_note text DEFAULT NULL)
RETURNS muse_approvals LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE row public.muse_approvals;
BEGIN
  PERFORM public._muse_check_owner(p_owner_key);
  IF p_decision NOT IN ('approved','denied') THEN RAISE EXCEPTION 'decision must be approved|denied' USING ERRCODE = '22023'; END IF;
  UPDATE public.muse_approvals SET status = p_decision, decided_at = now(), decision_note = p_note
  WHERE id = p_id AND status = 'pending' RETURNING * INTO row;
  IF row.id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.muse_approvals WHERE id = p_id) THEN
      RAISE EXCEPTION 'already decided' USING ERRCODE = '55000';
    END IF;
    RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN row;
END; $$;

CREATE OR REPLACE FUNCTION public.muse_owner_set_paused(p_owner_key text, p_paused boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public._muse_check_owner(p_owner_key);
  INSERT INTO public.muse_settings (key, value, updated_at, updated_by)
  VALUES ('paused', to_jsonb(COALESCE(p_paused,false)), now(), 'owner')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = 'owner';
  RETURN jsonb_build_object('paused', COALESCE(p_paused,false), 'updated_by', 'owner');
END; $$;

-- internal helpers not callable from API
REVOKE ALL ON FUNCTION public._muse_check_owner(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._muse_is_paused() FROM PUBLIC, anon, authenticated;
