-- Additive: owner-set standing grants (pre-approvals) readable by Muse
CREATE TABLE IF NOT EXISTS public.muse_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  action text NOT NULL,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  description text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by text NOT NULL DEFAULT 'owner'
);
ALTER TABLE public.muse_grants ENABLE ROW LEVEL SECURITY;

-- Muse (API key): read active, unexpired grants
CREATE OR REPLACE FUNCTION public.muse_list_grants(p_key text)
RETURNS SETOF muse_grants LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public._muse_check_key(p_key);
  RETURN QUERY SELECT g.* FROM public.muse_grants g
    WHERE g.active AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > now())
    ORDER BY g.created_at;
END; $$;

-- Owner: list all
CREATE OR REPLACE FUNCTION public.muse_owner_list_grants(p_owner_key text)
RETURNS SETOF muse_grants LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public._muse_check_owner(p_owner_key);
  RETURN QUERY SELECT g.* FROM public.muse_grants g ORDER BY g.created_at DESC;
END; $$;

-- Owner only: add
CREATE OR REPLACE FUNCTION public.muse_owner_add_grant(p_owner_key text, p_action text, p_scope jsonb, p_description text, p_expires_at timestamptz DEFAULT NULL)
RETURNS muse_grants LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE row public.muse_grants;
BEGIN
  PERFORM public._muse_check_owner(p_owner_key);
  IF p_action IS NULL OR length(trim(p_action)) = 0 THEN RAISE EXCEPTION 'action required' USING ERRCODE = '22023'; END IF;
  IF p_description IS NULL OR length(trim(p_description)) = 0 THEN RAISE EXCEPTION 'description required' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.muse_grants (action, scope, description, expires_at)
  VALUES (trim(p_action), COALESCE(p_scope, '{}'::jsonb), trim(p_description), p_expires_at)
  RETURNING * INTO row;
  RETURN row;
END; $$;

-- Owner only: revoke (soft, no delete)
CREATE OR REPLACE FUNCTION public.muse_owner_revoke_grant(p_owner_key text, p_id uuid)
RETURNS muse_grants LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE row public.muse_grants;
BEGIN
  PERFORM public._muse_check_owner(p_owner_key);
  UPDATE public.muse_grants SET active = false, revoked_at = now() WHERE id = p_id RETURNING * INTO row;
  IF row.id IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  RETURN row;
END; $$;

-- Seed: Stefan's Drive workspace grant (7 days, no delete)
INSERT INTO public.muse_grants (action, scope, description, expires_at, created_by)
SELECT 'google_drive.write',
  jsonb_build_object(
    'folder_id', '1VreGY04RIOti0E67nR6yirIIeHP5ddCK',
    'folder_name', 'Muse Arbeitsbereich',
    'subfolders', jsonb_build_object(
      'Freies Arbeiten (alle MCP-Tools)', '1RuRWSWza7esG8dY8Hyr1UJBoCy4RSDYl',
      'Ergebnisse', '1zzN9c9Ebq0Lx7QGRMliSDL0wJHeAOPap'),
    'allow', jsonb_build_array('create', 'update'),
    'deny', jsonb_build_array('delete', 'share', 'move_out', 'outside_folder')),
  'Google Drive: Dateien anlegen/bearbeiten nur im Ordner "Muse Arbeitsbereich" (inkl. Unterordner). Kein Löschen, kein Teilen, nichts außerhalb des Ordners.',
  now() + interval '7 days', 'owner'
WHERE NOT EXISTS (SELECT 1 FROM public.muse_grants WHERE action = 'google_drive.write'
  AND scope->>'folder_id' = '1VreGY04RIOti0E67nR6yirIIeHP5ddCK');
