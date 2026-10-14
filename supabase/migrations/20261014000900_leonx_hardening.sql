-- =====================================================================
-- LEONX OS — 009: Faz 7 yetki sertleştirmesi
-- Tetikleyici fonksiyonları (SECURITY DEFINER) istemci rollerince doğrudan çağrılamaz.
-- (Tetikleyiciler tablo değişikliğinde yine çalışır.) Tekrar çalıştırılabilir; nesne silmez.
-- =====================================================================
do $$
declare
  f text;
begin
  foreach f in array array['tg_wf_company', 'tg_wf_project', 'tg_wf_file', 'tg_wf_cad', 'tg_wf_takeoff', 'tg_wf_quote', 'tg_wf_task',
    'tg_project_stage_sync', 'tg_task_done', 'tg_prefs_touch'] loop
    execute format('revoke all on function public.%I() from public, anon, authenticated', f);
  end loop;
end;
$$;
