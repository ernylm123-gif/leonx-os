-- =====================================================================
-- LEONX OS — Teklif tabloları: gerçek Supabase için SİLME İÇERMEYEN test alt kümesi
-- Tek işlem içindedir ve sonunda bilerek hata verir: tüm değişiklikler (sayaç dahil) GERİ ALINIR.
-- Sonuç hata iletisinde "LEONX_TEKLIF_TEST_SONUC" ile döner. (Tam test: quotes.test.sql)
-- =====================================================================
do $$
declare
  v_owner text := (select user_id::text from public.app_owner);
  v_company uuid; v_q uuid; v_rev uuid; v_copy uuid; v_no text; v_n int; v_row public.quotes;
  passed int := 0; notes text := '';
begin
  if v_owner is null then raise exception 'Sahip tanımlı değil'; end if;
  -- anon
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  begin perform count(*) from public.quotes; notes := notes || ' anon-okudu';
  exception when insufficient_privilege then passed := passed + 1; end;
  begin perform public.copy_quote(gen_random_uuid(), 'kopya'); notes := notes || ' anon-rpc';
  exception when insufficient_privilege then passed := passed + 1; end;
  reset role;
  -- sahip
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.companies (name) values ('Uzak teklif testi') returning id into v_company;
  insert into public.quotes (company_id, title, quote_no, root_id) values (v_company, 'Test', 'SAHTE', gen_random_uuid()) returning id, quote_no into v_q, v_no;
  if v_no ~ '^[A-Z0-9]{1,8}-[0-9]{4}-[0-9]{4}$' and v_no <> 'SAHTE' then passed := passed + 1; else notes := notes || ' numara:' || v_no; end if;
  insert into public.quote_items (quote_id, poz_code, description, width_mm, height_mm, quantity, unit, unit_price) values (v_q, 'P1', 'Pencere', 1500, 2000, 4, 'm2', 1000);
  update public.quotes set status = 'gonderildi' where id = v_q;
  begin update public.quotes set title = 'X' where id = v_q; notes := notes || ' kilit-baslik';
  exception when check_violation then passed := passed + 1; end;
  begin update public.quote_items set unit_price = 1 where quote_id = v_q; notes := notes || ' kilit-kalem';
  exception when check_violation then passed := passed + 1; end;
  v_rev := public.copy_quote(v_q, 'revizyon');
  select * into v_row from public.quotes where id = v_rev;
  select count(*) into v_n from public.quote_items where quote_id = v_rev;
  if v_row.quote_no = v_no and v_row.revision = 2 and v_n = 1 and (select superseded from public.quotes where id = v_q) then passed := passed + 1; else notes := notes || ' revizyon'; end if;
  v_copy := public.copy_quote(v_rev, 'kopya');
  if (select quote_no from public.quotes where id = v_copy) <> v_no and exists (select 1 from public.quote_history where quote_id = v_copy and action = 'kopya') then passed := passed + 1; else notes := notes || ' kopya'; end if;
  select count(*) into v_n from public.quote_history where root_id = v_q;
  if v_n >= 3 then passed := passed + 1; else notes := notes || ' gecmis'; end if;
  begin perform count(*) from public.quote_counters; notes := notes || ' sayac-acik';
  exception when insufficient_privilege then passed := passed + 1; end;
  -- yetkisiz hesap
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.quotes;
  if v_n = 0 then passed := passed + 1; else notes := notes || ' yetkisiz-okuma'; end if;
  begin insert into public.quotes (company_id, title) values (v_company, 'Sızma'); notes := notes || ' yetkisiz-yazma';
  exception when insufficient_privilege then passed := passed + 1; end;
  reset role;
  raise exception 'LEONX_TEKLIF_TEST_SONUC basarili=%/11 sorunlar=[%]', passed, notes;
end;
$$;
