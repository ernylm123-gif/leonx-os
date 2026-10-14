-- =====================================================================
-- LEONX OS — Faz 7: gerçek Supabase için SİLME İÇERMEYEN test alt kümesi
-- Tek işlem içindedir ve sonunda bilerek hata verir: tüm değişiklikler GERİ ALINIR.
-- Sonuç hata iletisinde "LEONX_FAZ7_TEST_SONUC" ile döner. (Tam test: workflow.test.sql)
-- =====================================================================
do $$
declare
  v_owner text := (select user_id::text from public.app_owner);
  v_company uuid; v_p uuid; v_t uuid; v_q uuid; v_row public.projects; v_n int; v_first int; v_second int;
  passed int := 0; notes text := '';
begin
  if v_owner is null then raise exception 'Sahip tanımlı değil'; end if;
  -- anon
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  begin perform count(*) from public.notifications; notes := notes || ' anon-bildirim';
  exception when insufficient_privilege then passed := passed + 1; end;
  begin perform public.push_public_key(); notes := notes || ' anon-anahtar';
  exception when insufficient_privilege then passed := passed + 1; end;
  reset role;
  -- sahip
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.companies (name) values ('Uzak Faz7 testi') returning id into v_company;
  insert into public.projects (code, name, category, company_id, stage) values ('LX-F7-UZAK', 'Uzak Faz7', 'cephe', v_company, 'uretimde') returning * into v_row;
  v_p := v_row.id;
  if v_row.status = 'uretim' and v_row.progress >= 55 then passed := passed + 1; else notes := notes || ' asama-durum'; end if;
  update public.projects set status = 'montaj' where id = v_p returning * into v_row;
  if v_row.stage = 'montajda' then passed := passed + 1; else notes := notes || ' eski-istemci'; end if;
  select count(*) into v_n from public.project_events where project_id = v_p and kind in ('proje_olustu', 'asama');
  if v_n = 2 then passed := passed + 1; else notes := notes || ' zaman-cizelgesi:' || v_n; end if;
  insert into public.project_tasks (project_id, title, due_date) values (v_p, 'Uzak geciken görev', current_date - 2) returning id into v_t;
  v_first := public.check_reminders();
  v_second := public.check_reminders();
  if v_second = 0 and exists (select 1 from public.notifications where entity_id = v_t and kind = 'gorev_gecikti') then passed := passed + 1; else notes := notes || ' hatirlatma'; end if;
  update public.project_tasks set done = true where id = v_t;
  if exists (select 1 from public.project_events where ref_id = v_t and kind = 'gorev_tamam') then passed := passed + 1; else notes := notes || ' gorev-tamam'; end if;
  insert into public.quotes (company_id, project_id, title) values (v_company, v_p, 'Uzak Faz7 teklif') returning id into v_q;
  update public.quotes set status = 'gonderildi' where id = v_q;
  update public.quotes set status = 'kabul' where id = v_q;
  if (select stage from public.projects where id = v_p) = 'montajda' and exists (select 1 from public.notifications where entity_id = v_q and kind = 'teklif_kabul') then passed := passed + 1; else notes := notes || ' teklif-kabul'; end if;
  begin insert into public.notifications (user_id, category, kind, title, dedupe_key) values (auth.uid(), 'sistem', 'x', 'Sahte', 'sahte'); notes := notes || ' istemci-bildirim';
  exception when insufficient_privilege then passed := passed + 1; end;
  begin update public.notifications set title = 'x' where entity_id = v_q; notes := notes || ' baslik-degisti';
  exception when insufficient_privilege then passed := passed + 1; end;
  begin perform public.push_service_claim(1); notes := notes || ' servis-rpc';
  exception when insufficient_privilege then passed := passed + 1; end;
  begin perform count(*) from leonx_private.push_config; notes := notes || ' gizli-sema';
  exception when insufficient_privilege then passed := passed + 1; end;
  -- yetkisiz hesap
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.notifications;
  if v_n = 0 then passed := passed + 1; else notes := notes || ' yetkisiz-okuma'; end if;
  begin perform public.check_reminders(); notes := notes || ' yetkisiz-hatirlatma';
  exception when insufficient_privilege then passed := passed + 1; end;
  reset role;
  raise exception 'LEONX_FAZ7_TEST_SONUC basarili=%/14 sorunlar=[%]', passed, notes;
end;
$$;
