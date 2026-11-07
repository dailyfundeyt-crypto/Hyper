-- Additive. Dusty grants (replace legacy Store-5 grants by soft revoke), Store-Mandat, budget ledger.
UPDATE public.muse_grants SET active = false, revoked_at = now()
WHERE revoked_at IS NULL AND (scope->>'spreadsheet_id' = '1t-2BRAsq6T6A9_MxCC-2sgP8lFE8o8O1NP-d7_2m5kU'
   OR scope->'folder_ids' ? '1O_pLPesENoD_W10oixYtJYoUVcAMkQ1Z');

WITH rules AS (SELECT jsonb_build_object(
  'account', 'Stefans zweites Google-Konto (Flux-Konto)',
  'legacy_do_not_edit', jsonb_build_array('sheet 1t-2BRAsq6T6A9_MxCC-2sgP8lFE8o8O1NP-d7_2m5kU','folder 1O_pLPesENoD_W10oixYtJYoUVcAMkQ1Z','folder 1ZlKkqSZm19NguVKdVYkueoDSc43GvHN1'),
  'structure_note', 'Struktur ist neu: Spaltenköpfe im Dusty-Sheet selbst lesen, nicht von der alten Store-5-Struktur ausgehen.',
  'handoff_doc', 'Flux-Uebergabe-Store5.md (Regeln gelten weiter als allgemeine Regeln)',
  'rules', jsonb_build_array(
    'Keine neuen Ordner im Store-Drive anlegen',
    'Nichts löschen, nichts verschieben',
    'Nichts auf eBay',
    'Zustand oder Preis nie raten',
    'Gesperrte IDs nicht anfassen: 0528, 0548, 0551, 0553, 0572, 0626',
    'Vor jeder Änderung Backup + Logzeile; Logs nur ergänzen',
    'Stefan nur per request_approval fragen bei: Geld, Löschen, eBay, unklaren Produktangaben'),
  'locked_ids', jsonb_build_array('0528','0548','0551','0553','0572','0626')) AS r)
INSERT INTO public.muse_grants (action, scope, description, expires_at, created_by)
SELECT v.action, v.scope || (SELECT r FROM rules), v.description, now() + interval '7 days', 'owner'
FROM (VALUES
 ('google_sheets.edit',
  jsonb_build_object('spreadsheet_id','1WXIW7s2OSQtrDkAm8W4PuEnNRUma83tOnMsq2q13o6M','name','Dusty – Produktliste',
    'allow', jsonb_build_array('read_all','edit_cells_after_backup','append_log'),
    'before_each_change', jsonb_build_array('backup','log_line'),
    'deny', jsonb_build_array('delete_rows_or_tabs','overwrite_log','ebay','locked_ids')),
  'Sheet "Dusty – Produktliste" bearbeiten: alles lesen, Spaltenköpfe selbst lesen (neue Struktur); vor jeder Änderung Backup + Logzeile, Logs nur ergänzen. Keine gesperrten IDs, nichts löschen, kein eBay, Zustand/Preis nie raten.'),
 ('google_drive.read',
  jsonb_build_object('folder_id','1a00e-vC4332HAwmewBnur5L7pQrs_jlB','name','Dusty',
    'allow', jsonb_build_array('list','read'),
    'deny', jsonb_build_array('create_folder','delete','move','rename','share'),
    'rename_or_move', 'nur nach request_approval + approved'),
  'Drive-Ordner "Dusty" lesen. Keine neuen Ordner, nichts löschen/verschieben/umbenennen ohne Freigabe.'),
 ('store_mandate.dusty',
  jsonb_build_object('goal_revenue_eur_per_month', 300, 'budget_eur_per_month', 100,
    'free', jsonb_build_array(
      'Web-Recherche nach neuen Produkten und Einkaufsangeboten',
      'Platten bewerten nur anhand echter Verkaufspreise (sold prices), Quelle immer angeben, nie raten',
      'Fragen beantworten: wo liegt eine Platte, was verkauft sich gut, was ist sie wert',
      'Ergebnisse in die Inbox berichten'),
    'per_item_approval', jsonb_build_object(
      'outbound_message', 'jede Nachricht an Verkäufer: details {recipient, platform, text (vollständig)}',
      'purchase', 'jede Ausgabe: details {amount_eur, item, link}; über Restbudget = automatisch abgelehnt')),
  'Store-Mandat Dusty: Ziel 300 € Umsatz/Monat, Budget 100 €/Monat. Frei: Recherche, Bewertung nur mit echten Verkaufspreisen + Quelle, Auskünfte, Berichte in die Inbox. Pro Einzelfall request_approval: outbound_message (Nachricht an Verkäufer) und purchase (jede Ausgabe).')
) AS v(action, scope, description)
WHERE NOT EXISTS (SELECT 1 FROM public.muse_grants g WHERE g.action = v.action AND g.description = v.description);

-- budget ledger
CREATE TABLE IF NOT EXISTS public.muse_budget (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  month text NOT NULL,
  amount_eur numeric(10,2) NOT NULL CHECK (amount_eur >= 0),
  item text NOT NULL,
  approval_id uuid REFERENCES public.muse_approvals(id) ON DELETE SET NULL
);
ALTER TABLE public.muse_budget ENABLE ROW LEVEL SECURITY;
INSERT INTO public.muse_settings (key, value, updated_by)
VALUES ('budget_eur_per_month', '100'::jsonb, 'owner') ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public._muse_month() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT to_char(now() AT TIME ZONE 'Europe/Berlin', 'YYYY-MM');
$$;

CREATE OR REPLACE FUNCTION public._muse_budget() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE lim numeric; spent numeric; m text := public._muse_month();
BEGIN
  SELECT COALESCE((value)::text::numeric, 100) INTO lim FROM public.muse_settings WHERE key='budget_eur_per_month';
  lim := COALESCE(lim, 100);
  SELECT COALESCE(sum(amount_eur), 0) INTO spent FROM public.muse_budget WHERE month = m;
  RETURN jsonb_build_object('month', m, 'budget_eur', lim, 'spent_eur', spent,
    'remaining_eur', greatest(lim - spent, 0), 'currency', 'EUR');
END; $$;

CREATE OR REPLACE FUNCTION public.muse_budget_status(p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public._muse_check_key(p_key);
  RETURN public._muse_budget() || jsonb_build_object('entries',
    (SELECT COALESCE(jsonb_agg(to_jsonb(b) ORDER BY b.created_at), '[]'::jsonb)
     FROM public.muse_budget b WHERE b.month = public._muse_month()));
END; $$;

CREATE OR REPLACE FUNCTION public.muse_owner_budget_status(p_owner_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public._muse_check_owner(p_owner_key);
  RETURN public._muse_budget();
END; $$;

CREATE OR REPLACE FUNCTION public._muse_amount(p_details jsonb) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN replace(COALESCE(p_details->>'amount_eur', p_details->>'amount'), ',', '.')::numeric;
EXCEPTION WHEN others THEN RETURN NULL;
END; $$;

-- request_approval: purchase over remaining budget (or without valid amount) => auto-denied
CREATE OR REPLACE FUNCTION public.muse_request_approval(p_key text, p_message_id uuid, p_action text, p_summary text, p_details jsonb DEFAULT '{}'::jsonb)
RETURNS muse_approvals LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE row public.muse_approvals; amt numeric; rem numeric;
BEGIN
  PERFORM public._muse_check_key(p_key);
  IF public._muse_is_paused() THEN RAISE EXCEPTION 'paused: Muse ist pausiert (STOPP)' USING ERRCODE = '55000'; END IF;
  IF p_action IS NULL OR length(trim(p_action)) = 0 THEN RAISE EXCEPTION 'action required' USING ERRCODE = '22023'; END IF;
  IF p_summary IS NULL OR length(trim(p_summary)) = 0 THEN RAISE EXCEPTION 'summary required' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.muse_approvals (message_id, action, summary, details)
  VALUES (p_message_id, trim(p_action), trim(p_summary), COALESCE(p_details, '{}'::jsonb))
  RETURNING * INTO row;
  IF lower(row.action) = 'purchase' THEN
    amt := public._muse_amount(row.details);
    rem := (public._muse_budget()->>'remaining_eur')::numeric;
    IF amt IS NULL OR amt <= 0 THEN
      UPDATE public.muse_approvals SET status='denied', decided_at=now(),
        decision_note='auto: details.amount_eur fehlt oder ungültig' WHERE id=row.id RETURNING * INTO row;
    ELSIF amt > rem THEN
      UPDATE public.muse_approvals SET status='denied', decided_at=now(),
        decision_note=format('auto: Betrag %s € > Restbudget %s €', amt, rem) WHERE id=row.id RETURNING * INTO row;
    END IF;
  END IF;
  RETURN row;
END; $$;

-- decide: purchases re-checked against budget; approved purchase books ledger entry
CREATE OR REPLACE FUNCTION public.muse_decide_approval(p_owner_key text, p_id uuid, p_decision text, p_note text DEFAULT NULL)
RETURNS muse_approvals LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE row public.muse_approvals; amt numeric; rem numeric;
BEGIN
  PERFORM public._muse_check_owner(p_owner_key);
  IF p_decision NOT IN ('approved','denied') THEN RAISE EXCEPTION 'decision must be approved|denied' USING ERRCODE = '22023'; END IF;
  SELECT * INTO row FROM public.muse_approvals WHERE id = p_id FOR UPDATE;
  IF row.id IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  IF row.status <> 'pending' THEN RAISE EXCEPTION 'already decided' USING ERRCODE = '55000'; END IF;
  IF p_decision = 'approved' AND lower(row.action) = 'purchase' THEN
    amt := public._muse_amount(row.details);
    rem := (public._muse_budget()->>'remaining_eur')::numeric;
    IF amt IS NULL OR amt <= 0 OR amt > rem THEN
      UPDATE public.muse_approvals SET status='denied', decided_at=now(),
        decision_note=format('auto: Betrag %s € > Restbudget %s €', COALESCE(amt::text,'?'), rem)
      WHERE id=p_id RETURNING * INTO row;
      RETURN row;
    END IF;
    INSERT INTO public.muse_budget (month, amount_eur, item, approval_id)
    VALUES (public._muse_month(), amt, COALESCE(row.details->>'item', row.summary), row.id);
  END IF;
  UPDATE public.muse_approvals SET status = p_decision, decided_at = now(), decision_note = p_note
  WHERE id = p_id RETURNING * INTO row;
  RETURN row;
END; $$;

REVOKE ALL ON FUNCTION public._muse_budget() FROM PUBLIC, anon, authenticated;
