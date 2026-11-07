-- Additive: inbox-order approvals. Approval linked to an owner inbox message can be
-- consumed exactly once to execute any Zapier write/execute action.
ALTER TABLE public.muse_approvals ADD COLUMN IF NOT EXISTS used_for text;

CREATE OR REPLACE FUNCTION public.muse_consume_linked_approval(
  p_key text, p_id uuid, p_message_id uuid, p_action text DEFAULT NULL, p_tool text DEFAULT NULL)
RETURNS muse_approvals LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE row public.muse_approvals; msg public.muse_inbox_messages;
BEGIN
  PERFORM public._muse_check_key(p_key);
  IF public._muse_is_paused() THEN RAISE EXCEPTION 'paused: Muse ist pausiert (STOPP)' USING ERRCODE = '55000'; END IF;
  IF p_message_id IS NULL THEN RAISE EXCEPTION 'message_id required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO msg FROM public.muse_inbox_messages WHERE id = p_message_id;
  IF msg.id IS NULL THEN RAISE EXCEPTION 'message not found' USING ERRCODE = 'P0002'; END IF;
  IF msg.source IS NOT DISTINCT FROM 'api' THEN
    RAISE EXCEPTION 'message is not an owner inbox message' USING ERRCODE = '55000'; END IF;
  SELECT * INTO row FROM public.muse_approvals WHERE id = p_id FOR UPDATE;
  IF row.id IS NULL THEN RAISE EXCEPTION 'approval not found' USING ERRCODE = 'P0002'; END IF;
  IF row.message_id IS DISTINCT FROM p_message_id THEN
    RAISE EXCEPTION 'approval is not linked to this message_id' USING ERRCODE = '55000'; END IF;
  IF row.status <> 'approved' THEN RAISE EXCEPTION 'approval not approved (status %)', row.status USING ERRCODE = '55000'; END IF;
  IF row.used_at IS NOT NULL THEN RAISE EXCEPTION 'approval already used' USING ERRCODE = '55000'; END IF;
  IF p_action IS NOT NULL AND lower(row.action) <> lower(p_action) THEN
    RAISE EXCEPTION 'approval is for action %, not %', row.action, p_action USING ERRCODE = '55000'; END IF;
  UPDATE public.muse_approvals SET used_at = now(), used_for = left(p_tool, 200)
  WHERE id = p_id RETURNING * INTO row;
  RETURN row;
END; $$;

