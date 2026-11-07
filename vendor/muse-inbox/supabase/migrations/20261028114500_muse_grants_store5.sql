-- Data-only (additive): Store 5 standing grants (owner-set via Stefan), 7 days
WITH common AS (
  SELECT jsonb_build_object(
    'handoff_doc', 'Flux-Uebergabe-Store5.md',
    'rules', jsonb_build_array(
      'Keine neuen Ordner im Store-Drive anlegen',
      'Nichts löschen, nichts verschieben',
      'Nichts auf eBay (Status bleibt "Noch nicht online")',
      'Zustand oder Preis nie raten',
      'Gesperrte IDs nicht anfassen: 0528, 0548, 0551, 0553, 0572, 0626',
      'Vor jeder Änderung Backup + Logzeile; Log nur ergänzen',
      'Stefan nur per request_approval fragen bei: Geld, Löschen, eBay, unklaren Produktangaben'),
    'locked_ids', jsonb_build_array('0528','0548','0551','0553','0572','0626'),
    'ask_owner_for', jsonb_build_array('money','delete','ebay','unclear_product_data')) AS c
)
INSERT INTO public.muse_grants (action, scope, description, expires_at, created_by)
SELECT v.action, v.scope || (SELECT c FROM common), v.description, now() + interval '7 days', 'owner'
FROM (VALUES
  ('google_sheets.edit',
   jsonb_build_object('spreadsheet_id','1t-2BRAsq6T6A9_MxCC-2sgP8lFE8o8O1NP-d7_2m5kU',
     'allow', jsonb_build_array('read_all_tabs','edit_cells_after_backup'),
     'umbenenn_log', 'append_only (bestehende Zellen nie ändern)',
     'before_each_change', jsonb_build_array('backup','log_line'),
     'deny', jsonb_build_array('delete_rows_or_tabs','overwrite_log','ebay','locked_ids')),
   'Store-5-Auftrags-Sheet bearbeiten: alles lesen; Umbenenn-Log nur ergänzen; vor jeder Änderung Backup + Logzeile. Keine gesperrten IDs (0528, 0548, 0551, 0553, 0572, 0626), nichts löschen, kein eBay, Zustand/Preis nie raten.'),
  ('google_drive.read',
   jsonb_build_object('folder_ids', jsonb_build_array('1O_pLPesENoD_W10oixYtJYoUVcAMkQ1Z','1ZlKkqSZm19NguVKdVYkueoDSc43GvHN1'),
     'folder_names', jsonb_build_object('1O_pLPesENoD_W10oixYtJYoUVcAMkQ1Z','Gebraucht (Produktordner)','1ZlKkqSZm19NguVKdVYkueoDSc43GvHN1','Bilderordner'),
     'allow', jsonb_build_array('list','read'),
     'deny', jsonb_build_array('rename','move','create_folder','delete','share','upload'),
     'rename_or_move', 'nur nach request_approval + approved'),
   'Store-5-Drive lesen: Ordner "Gebraucht" und Bilderordner. Dort nie umbenennen oder verschieben ohne Freigabe; keine neuen Ordner, nichts löschen.')
) AS v(action, scope, description)
WHERE NOT EXISTS (SELECT 1 FROM public.muse_grants g WHERE g.action = v.action AND g.description = v.description);
