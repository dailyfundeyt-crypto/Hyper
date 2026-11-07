-- Additive: two-way task threads (updates, questions, owner replies) + calendar tasks.
ALTER TABLE public.muse_inbox_messages ADD COLUMN IF NOT EXISTS task_state text;          -- NULL | 'waiting'
ALTER TABLE public.muse_inbox_messages ADD COLUMN IF NOT EXISTS calendar_event_id text;
ALTER TABLE public.muse_inbox_messages ADD COLUMN IF NOT EXISTS due_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS muse_inbox_messages_calendar_event_uidx
  ON public.muse_inbox_messages (calendar_event_id) WHERE calendar_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.muse_task_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.muse_inbox_messages(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('update','question','reply')),
  author text NOT NULL CHECK (author IN ('muse','owner')),
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS muse_task_notes_msg_idx ON public.muse_task_notes (message_id, created_at);
ALTER TABLE public.muse_task_notes ENABLE ROW LEVEL SECURITY;  -- access only via SECURITY DEFINER RPCs

-- Muse: progress update or question (question => task waits for answer).
CREATE OR REPLACE FUNCTION public.muse_task_post(p_key text, p_message_id uuid, p_kind text, p_text text)
RETURNS public.muse_task_notes LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n public.muse_task_notes; m public.muse_inbox_messages;
BEGIN
  PERFORM public._muse_check_key(p_key);
  IF public._muse_is_paused() THEN RAISE EXCEPTION 'paused (STOPP)' USING ERRCODE = '55000'; END IF;
  IF p_kind NOT IN ('update','question') THEN RAISE EXCEPTION 'kind must be update|question' USING ERRCODE = '22023'; END IF;
  IF p_text IS NULL OR length(trim(p_text)) = 0 THEN RAISE EXCEPTION 'text required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO m FROM public.muse_inbox_messages WHERE id = p_message_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'message not found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.muse_task_notes (message_id, kind, author, text)
  VALUES (p_message_id, p_kind, 'muse', left(p_text, 8000)) RETURNING * INTO n;
  IF p_kind = 'question' THEN
    UPDATE public.muse_inbox_messages SET task_state = 'waiting' WHERE id = p_message_id;
  END IF;
  RETURN n;
END; $$;

-- Muse/UI (session or Muse key): notes of one task, or of all recent tasks when p_message_id is NULL.
CREATE OR REPLACE FUNCTION public.muse_task_notes_list(p_key text, p_message_id uuid DEFAULT NULL)
RETURNS SETOF public.muse_task_notes LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public._muse_check_key(p_key);
  RETURN QUERY SELECT n.* FROM public.muse_task_notes n
    WHERE (p_message_id IS NOT NULL AND n.message_id = p_message_id)
       OR (p_message_id IS NULL AND n.created_at > now() - interval '30 days')
    ORDER BY n.created_at ASC;
END; $$;

-- Owner only: reply in a task thread; clears 'waiting' and reopens the task => flag A.
CREATE OR REPLACE FUNCTION public.muse_owner_task_reply(p_owner_key text, p_message_id uuid, p_text text)
RETURNS public.muse_task_notes LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n public.muse_task_notes;
BEGIN
  PERFORM public._muse_check_owner(p_owner_key);
  IF p_text IS NULL OR length(trim(p_text)) = 0 THEN RAISE EXCEPTION 'text required' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.muse_inbox_messages WHERE id = p_message_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'message not found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.muse_task_notes (message_id, kind, author, text)
  VALUES (p_message_id, 'reply', 'owner', left(p_text, 8000)) RETURNING * INTO n;
  UPDATE public.muse_inbox_messages
     SET task_state = NULL, status = 'new', done_at = NULL
   WHERE id = p_message_id;
  RETURN n;
END; $$;

-- Calendar flow: create a task from a calendar event, deduped by event_id.
CREATE OR REPLACE FUNCTION public.muse_add_calendar_task(p_key text, p_event_id text, p_title text, p_due_at timestamptz, p_prompt text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE existing uuid; row public.muse_inbox_messages;
BEGIN
  PERFORM public._muse_check_key(p_key);
  IF public._muse_is_paused() THEN RAISE EXCEPTION 'paused (STOPP)' USING ERRCODE = '55000'; END IF;
  IF p_event_id IS NULL OR length(trim(p_event_id)) = 0 THEN RAISE EXCEPTION 'event_id required' USING ERRCODE = '22023'; END IF;
  SELECT id INTO existing FROM public.muse_inbox_messages WHERE calendar_event_id = p_event_id;
  IF existing IS NOT NULL THEN RETURN jsonb_build_object('created', false, 'message_id', existing); END IF;
  INSERT INTO public.muse_inbox_messages (text, agent, source, calendar_event_id, due_at)
  VALUES (left('📅 ' || COALESCE(NULLIF(trim(p_title), ''), 'Dusty') ||
               COALESCE(E'\n' || NULLIF(trim(p_prompt), ''), ''), 20000),
          'muse', 'calendar', p_event_id, p_due_at)
  ON CONFLICT DO NOTHING
  RETURNING * INTO row;
  IF row.id IS NULL THEN
    SELECT id INTO existing FROM public.muse_inbox_messages WHERE calendar_event_id = p_event_id;
    RETURN jsonb_build_object('created', false, 'message_id', existing);
  END IF;
  RETURN jsonb_build_object('created', true, 'message_id', row.id);
END; $$;

-- Public hook flag: A only for open tasks that are NOT waiting on Stefan's answer.
CREATE OR REPLACE FUNCTION public.muse_flag_by_token(p_token text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE h text; found boolean;
BEGIN
  SELECT value #>> '{}' INTO h FROM public.muse_settings WHERE key = 'flag_token_hash';
  IF h IS NULL OR p_token IS NULL OR length(p_token) < 32
     OR encode(sha256(convert_to(p_token, 'UTF8')), 'hex') IS DISTINCT FROM h THEN
    RETURN NULL;
  END IF;
  IF public._muse_is_paused() THEN RETURN 'B'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.muse_inbox_messages m
    WHERE m.status = 'new' AND (m.agent IS NULL OR m.agent = 'muse')
      AND m.task_state IS DISTINCT FROM 'waiting' LIMIT 1) INTO found;
  RETURN CASE WHEN COALESCE(found, false) THEN 'A' ELSE 'B' END;
END; $$;
