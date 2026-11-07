-- Additive: proxied tool-call log + single-use approvals
CREATE TABLE IF NOT EXISTS public.muse_tool_log (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  tool text NOT NULL,
  args_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL,          -- forwarded_ok | forwarded_error | blocked
  detail text,
  message_id uuid,
  approval_id uuid
);
ALTER TABLE public.muse_tool_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.muse_approvals ADD COLUMN IF NOT EXISTS used_at timestamptz;

CREATE OR REPLACE FUNCTION public.muse_log_tool(p_key text, p_tool text, p_args jsonb, p_status text, p_detail text DEFAULT NULL, p_message_id uuid DEFAULT NULL, p_approval_id uuid DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE nid bigint;
BEGIN
  PERFORM public._muse_check_key(p_key);
  INSERT INTO public.muse_tool_log (tool, args_summary, status, detail, message_id, approval_id)
  VALUES (p_tool, COALESCE(p_args,'{}'::jsonb), p_status, left(p_detail, 2000), p_message_id, p_approval_id)
  RETURNING id INTO nid;
  RETURN nid;
END; $$;

-- Consume an approved approval exactly once for the given action type
CREATE OR REPLACE FUNCTION public.muse_consume_approval(p_key text, p_id uuid, p_action text)
RETURNS muse_approvals LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE row public.muse_approvals;
BEGIN
  PERFORM public._muse_check_key(p_key);
  SELECT * INTO row FROM public.muse_approvals WHERE id = p_id FOR UPDATE;
  IF row.id IS NULL THEN RAISE EXCEPTION 'approval not found' USING ERRCODE = 'P0002'; END IF;
  IF row.status <> 'approved' THEN RAISE EXCEPTION 'approval not approved (status %)', row.status USING ERRCODE = '55000'; END IF;
  IF row.used_at IS NOT NULL THEN RAISE EXCEPTION 'approval already used' USING ERRCODE = '55000'; END IF;
  IF p_action IS NOT NULL AND lower(row.action) <> lower(p_action) THEN
    RAISE EXCEPTION 'approval is for action %, not %', row.action, p_action USING ERRCODE = '55000'; END IF;
  UPDATE public.muse_approvals SET used_at = now() WHERE id = p_id RETURNING * INTO row;
  RETURN row;
END; $$;
