-- =====================================================================
-- LEONX OS — Metraj tabloları: gerçek Supabase için SİLME İÇERMEYEN test alt kümesi
-- Tek işlem içindedir ve sonunda bilerek hata verir: tüm değişiklikler GERİ ALINIR.
-- Sonuç, hata iletisinde "LEONX_METRAJ_TEST_SONUC" ile döner. (Tam test: quantity.test.sql)
-- =====================================================================
do $$
declare
  v_owner text := (select user_id::text from public.app_owner);
  v_project uuid; v_takeoff uuid; v_item uuid; v_rev uuid; v_n int; v_row record;
  passed int := 0; notes text := '';
begin
  if v_owner is null then raise exception 'Sahip tanımlı değil'; end if;
  -- anon
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  begin perform count(*) from public.quantity_items; raise exception 'FAIL anon okudu';
  exception when insufficient_privilege then passed := passed + 1; end;
  begin perform public.create_takeoff_revision(gen_random_uuid(), 'x'); raise exception 'FAIL anon rpc';
  exception when insufficient_privilege then passed := passed + 1; end;
  reset role;
  -- sahip
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.projects (code, name, category) values ('LX-TEST-REMOTE', 'Uzak test', 'pvc_dograma') returning id into v_project;
  insert into public.quantity_takeoffs (project_id, name, revision) values (v_project, 'Test', 1) returning id into v_takeoff;
  insert into public.quantity_items (takeoff_id, project_id, poz_code, category, width_mm, height_mm, quantity, verification)
    values (v_takeoff, gen_random_uuid(), 'P1', 'pvc_pencere', 1200, 1500, 3, 'onaylandi') returning id into v_item;
  select * into v_row from public.quantity_items where id = v_item;
  if v_row.project_id = v_project and v_row.created_by::text = v_owner then passed := passed + 1; else notes := notes || ' project_id/created_by'; end if;
  update public.quantity_items set quantity = 4 where id = v_item and version = 1;
  select count(*) into v_n from public.quantity_item_history where item_id = v_item and action = 'guncelle' and changes->'quantity'->>'yeni' = '4';
  if v_n = 1 then passed := passed + 1; else notes := notes || ' gecmis'; end if;
  begin insert into public.quantity_items (takeoff_id, project_id, poz_code, category, quantity) values (v_takeoff, v_project, 'X', 'pvc_pencere', 0); notes := notes || ' adet0';
  exception when check_violation then passed := passed + 1; end;
  update public.quantity_takeoffs set status = 'onaylandi' where id = v_takeoff;
  select approved_by::text into v_row from public.quantity_takeoffs where id = v_takeoff;
  if v_row.approved_by = v_owner then passed := passed + 1; else notes := notes || ' onaylayan'; end if;
  begin update public.quantity_items set quantity = 9 where id = v_item; notes := notes || ' kilit';
  exception when check_violation then passed := passed + 1; end;
  v_rev := public.create_takeoff_revision(v_takeoff, 'Rev 2');
  select count(*) into v_n from public.quantity_items where takeoff_id = v_rev and quantity = 4;
  if v_n = 1 then passed := passed + 1; else notes := notes || ' revizyon'; end if;
  -- yetkisiz hesap
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.quantity_items;
  if v_n = 0 then passed := passed + 1; else notes := notes || ' yetkisiz-okuma'; end if;
  begin insert into public.quantity_takeoffs (project_id, name, revision) values (v_project, 'Sızma', 50); notes := notes || ' yetkisiz-yazma';
  exception when insufficient_privilege then passed := passed + 1; end;
  reset role;
  raise exception 'LEONX_METRAJ_TEST_SONUC basarili=%/10 sorunlar=[%]', passed, notes;
end;
$$;
