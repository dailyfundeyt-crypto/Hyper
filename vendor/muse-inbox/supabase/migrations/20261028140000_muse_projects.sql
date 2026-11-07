-- Additive: project docs (Projekte), calendar activation, materialized project tasks, summary cards.
CREATE TABLE IF NOT EXISTS public.muse_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  body text NOT NULL DEFAULT '',
  always_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.muse_projects ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.muse_project_activations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.muse_projects(id) ON DELETE CASCADE,
  event_id text NOT NULL UNIQUE,
  source text NOT NULL DEFAULT 'calendar' CHECK (source IN ('calendar','always')),
  active_on date NOT NULL,
  due_at timestamptz,
  summary jsonb,
  summary_posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS muse_project_activations_proj_idx ON public.muse_project_activations (project_id, active_on DESC);
ALTER TABLE public.muse_project_activations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.muse_inbox_messages ADD COLUMN IF NOT EXISTS project_id uuid;
ALTER TABLE public.muse_inbox_messages ADD COLUMN IF NOT EXISTS activation_id uuid;
ALTER TABLE public.muse_inbox_messages ADD COLUMN IF NOT EXISTS project_task_index int;
CREATE UNIQUE INDEX IF NOT EXISTS muse_inbox_messages_activation_task_uidx
  ON public.muse_inbox_messages (activation_id, project_task_index) WHERE activation_id IS NOT NULL;

-- Task lines of a doc: "- x", "* x", "1. x", "- [ ] x" (checked "[x]" lines are skipped). No list => whole body is one task.
CREATE OR REPLACE FUNCTION public._muse_project_task_lines(p_body text)
RETURNS TABLE(idx int, task text) LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE l text; i int := 0; m text[]; any_list boolean := false;
BEGIN
  FOR l IN SELECT x FROM regexp_split_to_table(COALESCE(p_body,''), E'\n') AS x LOOP
    m := regexp_match(l, '^\s*(?:[-*•]|\d+[.)])\s+(\[[ xX]\]\s*)?(.+?)\s*$');
    IF m IS NOT NULL THEN
      any_list := true;
      IF m[1] IS NULL OR m[1] !~* 'x' THEN
        i := i + 1; idx := i; task := m[2]; RETURN NEXT;
      END IF;
    END IF;
  END LOOP;
  IF NOT any_list AND length(trim(COALESCE(p_body,''))) > 0 THEN
    idx := 1; task := trim(p_body); RETURN NEXT;
  END IF;
END; $$;

-- Resolve a doc by id, by an inbox link ".../projekte/<id>", exact name, or fuzzy name (e.g. "Dusty: Projekt Auftrag 1").
CREATE OR REPLACE FUNCTION public._muse_project_resolve(p_ref text) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r text; u text; pid uuid; norm text;
BEGIN
  r := trim(COALESCE(p_ref,''));
  IF r = '' THEN RETURN NULL; END IF;
  u := substring(r FROM '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})');
  IF u IS NOT NULL THEN
    SELECT id INTO pid FROM public.muse_projects WHERE id = u::uuid;
    IF pid IS NOT NULL THEN RETURN pid; END IF;
  END IF;
  SELECT id INTO pid FROM public.muse_projects WHERE lower(trim(name)) = lower(r) ORDER BY updated_at DESC LIMIT 1;
  IF pid IS NOT NULL THEN RETURN pid; END IF;
  norm := trim(regexp_replace(lower(regexp_replace(r, '^\s*dusty\s*[:\-–]\s*', '', 'i')), '[^[:alnum:]äöüß]+', ' ', 'g'));
  IF norm = '' THEN RETURN NULL; END IF;
  SELECT id INTO pid FROM public.muse_projects p,
    LATERAL (SELECT trim(regexp_replace(lower(p.name), '[^[:alnum:]äöüß]+', ' ', 'g')) AS n) x
  WHERE x.n <> '' AND (x.n = norm OR position(x.n IN norm) > 0 OR position(norm IN x.n) > 0)
  ORDER BY (x.n = norm) DESC, length(x.n) DESC, p.updated_at DESC LIMIT 1;
  RETURN pid;
END; $$;

-- Create one inbox task per doc task line for an activation (idempotent).
CREATE OR REPLACE FUNCTION public._muse_project_materialize(p_activation uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE a public.muse_project_activations; p public.muse_projects; t record;
BEGIN
  SELECT * INTO a FROM public.muse_project_activations WHERE id = p_activation;
  SELECT * INTO p FROM public.muse_projects WHERE id = a.project_id;
  FOR t IN SELECT * FROM public._muse_project_task_lines(p.body) LOOP
    INSERT INTO public.muse_inbox_messages (text, agent, source, due_at, project_id, activation_id, project_task_index)
    VALUES (left('📁 ' || p.name || E'\n' || t.task, 20000), 'muse', 'project', a.due_at, p.id, a.id, t.idx)
    ON CONFLICT DO NOTHING;
  END LOOP;
END; $$;

CREATE OR REPLACE FUNCTION public._muse_activation_json(p_activation uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'activation_id', a.id, 'project_id', a.project_id, 'event_id', a.event_id, 'source', a.source,
    'active_on', a.active_on, 'due_at', a.due_at, 'summary_posted_at', a.summary_posted_at,
    'tasks', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'message_id', m.id, 'index', m.project_task_index, 'text', m.text, 'status', m.status,
        'waiting_for_answer', m.task_state = 'waiting', 'result', m.result, 'done_at', m.done_at)
        ORDER BY m.project_task_index)
      FROM public.muse_inbox_messages m WHERE m.activation_id = a.id), '[]'::jsonb))
  FROM public.muse_project_activations a WHERE a.id = p_activation;
$$;

-- Muse (daily calendar check): activate a doc for an event. Dedupe by event_id. matched=false => use add_task_from_calendar.
CREATE OR REPLACE FUNCTION public.muse_activate_project(p_key text, p_event_id text, p_ref text, p_due_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE pid uuid; a public.muse_project_activations; created boolean := false; p public.muse_projects;
BEGIN
  PERFORM public._muse_check_key(p_key);
  IF public._muse_is_paused() THEN RAISE EXCEPTION 'paused (STOPP)' USING ERRCODE = '55000'; END IF;
  IF p_event_id IS NULL OR length(trim(p_event_id)) = 0 THEN RAISE EXCEPTION 'event_id required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO a FROM public.muse_project_activations WHERE event_id = p_event_id;
  IF a.id IS NULL THEN
    pid := public._muse_project_resolve(p_ref);
    IF pid IS NULL THEN RETURN jsonb_build_object('matched', false); END IF;
    INSERT INTO public.muse_project_activations (project_id, event_id, source, active_on, due_at)
    VALUES (pid, p_event_id, 'calendar',
            COALESCE((p_due_at AT TIME ZONE 'Europe/Berlin')::date, (now() AT TIME ZONE 'Europe/Berlin')::date), p_due_at)
    ON CONFLICT (event_id) DO NOTHING RETURNING * INTO a;
    IF a.id IS NULL THEN SELECT * INTO a FROM public.muse_project_activations WHERE event_id = p_event_id;
    ELSE created := true; END IF;
  END IF;
  PERFORM public._muse_project_materialize(a.id);
  SELECT * INTO p FROM public.muse_projects WHERE id = a.project_id;
  RETURN jsonb_build_object('matched', true, 'activated', created, 'deduped', NOT created,
    'project', jsonb_build_object('id', p.id, 'name', p.name),
    'work_now', a.due_at IS NULL OR a.due_at <= now() + interval '15 minutes')
    || public._muse_activation_json(a.id);
END; $$;

-- Muse/UI: create today's activation for "immer aktiv" docs (idempotent; nothing while STOPP).
CREATE OR REPLACE FUNCTION public.muse_projects_ensure_today(p_key text) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE d date := (now() AT TIME ZONE 'Europe/Berlin')::date; p record; a public.muse_project_activations; n int := 0;
BEGIN
  PERFORM public._muse_check_key(p_key);
  IF public._muse_is_paused() THEN RETURN 0; END IF;
  FOR p IN SELECT * FROM public.muse_projects WHERE always_active LOOP
    INSERT INTO public.muse_project_activations (project_id, event_id, source, active_on)
    VALUES (p.id, 'always:' || p.id || ':' || d, 'always', d)
    ON CONFLICT (event_id) DO NOTHING RETURNING * INTO a;
    IF a.id IS NOT NULL THEN PERFORM public._muse_project_materialize(a.id); n := n + 1; END IF;
    a := NULL;
  END LOOP;
  RETURN n;
END; $$;

-- Summary for an activation (default: latest activation of the doc). p_post=true stores it (post_project_summary).
CREATE OR REPLACE FUNCTION public.muse_project_summary(p_key text, p_ref text, p_activation_id uuid DEFAULT NULL, p_post boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE pid uuid; a public.muse_project_activations; p public.muse_projects; s jsonb;
BEGIN
  PERFORM public._muse_check_key(p_key);
  IF p_activation_id IS NOT NULL THEN
    SELECT * INTO a FROM public.muse_project_activations WHERE id = p_activation_id;
  ELSE
    pid := public._muse_project_resolve(p_ref);
    IF pid IS NULL THEN RAISE EXCEPTION 'project not found' USING ERRCODE = 'P0002'; END IF;
    SELECT * INTO a FROM public.muse_project_activations WHERE project_id = pid
      ORDER BY active_on DESC, created_at DESC LIMIT 1;
  END IF;
  IF a.id IS NULL THEN RAISE EXCEPTION 'no activation found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO p FROM public.muse_projects WHERE id = a.project_id;
  SELECT jsonb_build_object(
    'project_id', p.id, 'project_name', p.name, 'activation_id', a.id, 'active_on', a.active_on, 'due_at', a.due_at,
    'event_id', a.event_id, 'source', a.source,
    'total', count(m.*),
    'done', count(m.*) FILTER (WHERE m.status = 'done'),
    'all_done', count(m.*) > 0 AND count(m.*) FILTER (WHERE m.status <> 'done') = 0,
    'open', COALESCE(jsonb_agg(jsonb_build_object('message_id', m.id, 'text', m.text))
              FILTER (WHERE m.status <> 'done' AND COALESCE(m.task_state,'') <> 'waiting'), '[]'),
    'open_questions', COALESCE(jsonb_agg(jsonb_build_object('message_id', m.id, 'text', m.text,
              'question', (SELECT n.text FROM public.muse_task_notes n WHERE n.message_id = m.id AND n.kind = 'question'
                           ORDER BY n.created_at DESC LIMIT 1)))
              FILTER (WHERE m.status <> 'done' AND m.task_state = 'waiting'), '[]'),
    'results', COALESCE(jsonb_agg(jsonb_build_object('message_id', m.id, 'text', m.text, 'result', m.result))
              FILTER (WHERE m.status = 'done'), '[]'),
    'waiting_approvals', COALESCE((SELECT jsonb_agg(jsonb_build_object('approval_id', ap.id, 'message_id', ap.message_id,
              'action', ap.action, 'summary', ap.summary))
              FROM public.muse_approvals ap JOIN public.muse_inbox_messages mm ON mm.id = ap.message_id
              WHERE mm.activation_id = a.id AND ap.status = 'pending'), '[]'),
    'generated_at', now())
  INTO s
  FROM public.muse_inbox_messages m WHERE m.activation_id = a.id;
  IF p_post THEN
    UPDATE public.muse_project_activations SET summary = s, summary_posted_at = now() WHERE id = a.id;
    s := s || jsonb_build_object('posted', true);
  END IF;
  RETURN s;
END; $$;

-- Muse/UI: all docs with their recent activations.
CREATE OR REPLACE FUNCTION public.muse_projects_list(p_key text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE d date := (now() AT TIME ZONE 'Europe/Berlin')::date;
BEGIN
  PERFORM public._muse_check_key(p_key);
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id', p.id, 'name', p.name, 'body', p.body, 'always_active', p.always_active,
    'created_at', p.created_at, 'updated_at', p.updated_at,
    'active_today', p.always_active OR EXISTS (SELECT 1 FROM public.muse_project_activations a WHERE a.project_id = p.id AND a.active_on = d),
    'activations', COALESCE((SELECT jsonb_agg(jsonb_build_object('activation_id', a.id, 'event_id', a.event_id, 'source', a.source,
         'active_on', a.active_on, 'due_at', a.due_at, 'summary_posted_at', a.summary_posted_at) ORDER BY a.active_on DESC, a.created_at DESC)
       FROM public.muse_project_activations a WHERE a.project_id = p.id AND a.active_on >= d - 30), '[]'::jsonb))
    ORDER BY p.updated_at DESC) FROM public.muse_projects p), '[]'::jsonb);
END; $$;

-- Muse/UI: one doc (id, link or name) incl. activations with their tasks.
CREATE OR REPLACE FUNCTION public.muse_project_get(p_key text, p_ref text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE pid uuid; p public.muse_projects; d date := (now() AT TIME ZONE 'Europe/Berlin')::date;
BEGIN
  PERFORM public._muse_check_key(p_key);
  pid := public._muse_project_resolve(p_ref);
  IF pid IS NULL THEN RAISE EXCEPTION 'project not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO p FROM public.muse_projects WHERE id = pid;
  RETURN jsonb_build_object('id', p.id, 'name', p.name, 'body', p.body, 'always_active', p.always_active,
    'created_at', p.created_at, 'updated_at', p.updated_at,
    'active_today', p.always_active OR EXISTS (SELECT 1 FROM public.muse_project_activations a WHERE a.project_id = p.id AND a.active_on = d),
    'doc_tasks', COALESCE((SELECT jsonb_agg(jsonb_build_object('index', t.idx, 'text', t.task) ORDER BY t.idx)
                           FROM public._muse_project_task_lines(p.body) t), '[]'::jsonb),
    'activations', COALESCE((SELECT jsonb_agg(public._muse_activation_json(a.id) ORDER BY a.active_on DESC, a.created_at DESC)
                             FROM public.muse_project_activations a WHERE a.project_id = p.id AND a.active_on >= d - 30), '[]'::jsonb));
END; $$;

-- Owner only: create/update a doc.
CREATE OR REPLACE FUNCTION public.muse_owner_project_save(p_owner_key text, p_id uuid, p_name text, p_body text, p_always_active boolean)
RETURNS public.muse_projects LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE p public.muse_projects;
BEGIN
  PERFORM public._muse_check_owner(p_owner_key);
  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN RAISE EXCEPTION 'name required' USING ERRCODE = '22023'; END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.muse_projects (name, body, always_active)
    VALUES (left(trim(p_name), 300), left(COALESCE(p_body,''), 100000), COALESCE(p_always_active, false)) RETURNING * INTO p;
  ELSE
    UPDATE public.muse_projects SET name = left(trim(p_name), 300), body = left(COALESCE(p_body,''), 100000),
      always_active = COALESCE(p_always_active, always_active), updated_at = now()
    WHERE id = p_id RETURNING * INTO p;
    IF p.id IS NULL THEN RAISE EXCEPTION 'project not found' USING ERRCODE = 'P0002'; END IF;
  END IF;
  RETURN p;
END; $$;

REVOKE ALL ON FUNCTION public._muse_project_resolve(text), public._muse_project_materialize(uuid), public._muse_activation_json(uuid) FROM PUBLIC, anon, authenticated;
