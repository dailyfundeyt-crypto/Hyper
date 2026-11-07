-- Additive: unguessable public flag token for Muse hooks (no secret in the hook).
-- Only the sha256 hash is stored. Endpoint returns only A|B.
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
    WHERE m.status = 'new' AND (m.agent IS NULL OR m.agent = 'muse') LIMIT 1) INTO found;
  RETURN CASE WHEN COALESCE(found, false) THEN 'A' ELSE 'B' END;
END; $$;

-- Owner only: create/rotate the token; returns the plain token once.
CREATE OR REPLACE FUNCTION public.muse_owner_rotate_flag_token(p_owner_key text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $$
DECLARE t text;
BEGIN
  PERFORM public._muse_check_owner(p_owner_key);
  t := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  INSERT INTO public.muse_settings (key, value, updated_at, updated_by)
  VALUES ('flag_token_hash', to_jsonb(encode(sha256(convert_to(t, 'UTF8')), 'hex')), now(), 'owner')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = 'owner';
  RETURN t;
END; $$;
