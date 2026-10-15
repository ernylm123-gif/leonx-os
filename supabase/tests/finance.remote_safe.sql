-- =====================================================================
-- LEONX OS — Faz 8: gerçek Supabase için SİLME İÇERMEYEN test alt kümesi
-- Tek işlem içindedir ve sonunda bilerek hata verir: tüm değişiklikler GERİ ALINIR.
-- Sonuç hata iletisinde "LEONX_FAZ8_TEST_SONUC" ile döner. (Tam test: finance.test.sql)
-- =====================================================================
do $$
declare
  v_owner text := (select user_id::text from public.app_owner);
  v_c uuid; v_p uuid; v_tk uuid; v_i1 uuid; v_i2 uuid; v_a uuid; v_b uuid; v_n int; v_first int; v_second int;
  v_line public.project_cost_lines; r record;
  passed int := 0; notes text := '';
begin
  if v_owner is null then raise exception 'Sahip tanımlı değil'; end if;
  -- anon
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  begin perform count(*) from public.project_expenses; notes := notes || ' anon-gider';
  exception when insufficient_privilege then passed := passed + 1; end;
  begin perform count(*) from public.project_receivables; notes := notes || ' anon-gorunum';
  exception when insufficient_privilege then passed := passed + 1; end;
  reset role;
  -- sahip
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.companies (name) values ('Uzak Faz8 testi') returning id into v_c;
  insert into public.projects (code, name, category, company_id, stage) values ('LX-F8-UZAK', 'Uzak Faz8', 'cephe', v_c, 'uretimde') returning id into v_p;
  -- hassasiyet
  insert into public.project_cost_lines (project_id, cost_group, description, quantity, unit, unit_cost, currency)
  values (v_p, 'iscilik', 'Uzak hassasiyet', 12.345, 'saat', 1234.56, 'TRY') returning * into v_line;
  if round(v_line.quantity * v_line.unit_cost, 2) = 15240.64 then passed := passed + 1; else notes := notes || ' hassasiyet'; end if;
  -- onaysız metraj aktarılamaz, onaylı bir kez
  insert into public.quantity_takeoffs (project_id, name, revision) values (v_p, 'Uzak metraj', 1) returning id into v_tk;
  insert into public.quantity_items (takeoff_id, project_id, poz_code, category, width_mm, height_mm, quantity, verification)
  values (v_tk, v_p, 'U1', 'al_pencere', 1500, 2000, 4, 'onaylandi') returning id into v_i1;
  insert into public.quantity_items (takeoff_id, project_id, poz_code, category, width_mm, height_mm, quantity, verification)
  values (v_tk, v_p, 'U2', 'al_pencere', 1000, 1000, 1, 'bekliyor') returning id into v_i2;
  begin
    insert into public.project_cost_lines (project_id, cost_group, description, quantity, unit, unit_cost, source, source_takeoff_id, source_item_id)
    values (v_p, 'profil', 'U1', 12, 'm2', 1000, 'metraj', v_tk, v_i1);
    notes := notes || ' taslak-aktarim';
  exception when check_violation then passed := passed + 1; end;
  update public.quantity_takeoffs set status = 'onaylandi' where id = v_tk;
  insert into public.project_cost_lines (project_id, cost_group, description, quantity, unit, unit_cost, source, source_takeoff_id, source_item_id)
  values (v_p, 'profil', 'U1', 12, 'm2', 1000, 'metraj', v_tk, v_i1);
  begin
    insert into public.project_cost_lines (project_id, cost_group, description, quantity, unit, unit_cost, source, source_takeoff_id, source_item_id)
    values (v_p, 'profil', 'U1 tekrar', 12, 'm2', 1000, 'metraj', v_tk, v_i1);
    notes := notes || ' cift-aktarim';
  exception when unique_violation then passed := passed + 1; end;
  begin
    insert into public.project_cost_lines (project_id, cost_group, description, quantity, unit, unit_cost, source, source_takeoff_id, source_item_id)
    values (v_p, 'profil', 'U2', 1, 'm2', 1000, 'metraj', v_tk, v_i2);
    notes := notes || ' dogrulanmamis-aktarim';
  exception when check_violation then passed := passed + 1; end;
  -- kur: projeye özel girilen kur kullanılır, aynı birim 1
  insert into public.fx_rates (rate_date, from_currency, to_currency, rate, project_id, source) values (current_date, 'EUR', 'USD', 1.2345674, v_p, 'Uzak test');
  if public.leonx_fx_rate('EUR', 'USD', current_date, v_p) = 1.234567 and public.leonx_fx_rate('TRY', 'TRY', current_date, v_p) = 1 then
    passed := passed + 1;
  else
    notes := notes || ' kur';
  end if;
  -- bütçe aşımı: tahmini 27240,64; 28000 gider → tek bildirim, tekrar yok
  insert into public.project_expenses (project_id, expense_date, cost_group, description, amount, currency)
  values (v_p, current_date, 'profil', 'Uzak gider 1', 20000, 'TRY');
  insert into public.project_expenses (project_id, expense_date, cost_group, description, amount, currency)
  values (v_p, current_date, 'montaj', 'Uzak gider 2', 8000, 'TRY');
  insert into public.project_expenses (project_id, expense_date, cost_group, description, amount, currency)
  values (v_p, current_date, 'nakliye', 'Uzak gider 3', 100, 'TRY');
  select count(*) into v_n from public.project_events where project_id = v_p and kind = 'butce_asildi';
  if v_n = 1 then passed := passed + 1; else notes := notes || ' butce-olay:' || v_n; end if;
  select count(*) into v_n from public.project_events where project_id = v_p and kind = 'gider';
  if v_n = 3 then passed := passed + 1; else notes := notes || ' gider-olay:' || v_n; end if;
  -- ödeme planı ve FIFO
  insert into public.project_payment_schedule (project_id, kind, label, due_date, amount, currency, sort_order)
  values (v_p, 'pesinat', 'Uzak peşinat', current_date - 10, 1000, 'TRY', 1) returning id into v_a;
  insert into public.project_payment_schedule (project_id, kind, label, due_date, amount, currency, sort_order)
  values (v_p, 'ara_odeme', 'Uzak ara', current_date + 2, 2000, 'TRY', 2) returning id into v_b;
  insert into public.project_collections (project_id, received_date, amount, currency) values (v_p, current_date, 1200, 'TRY');
  select * into r from public.project_receivables where id = v_b;
  if r.collected = 200 and r.status = 'kismi' and (select status from public.project_receivables where id = v_a) = 'tahsil_edildi' then passed := passed + 1; else notes := notes || ' fifo'; end if;
  begin
    insert into public.project_collections (project_id, received_date, amount, currency, schedule_id) values (v_p, current_date, 1, 'EUR', v_b);
    notes := notes || ' para-birimi';
  exception when check_violation then passed := passed + 1; end;
  -- hatırlatma tekilleştirme
  v_first := public.check_reminders();
  v_second := public.check_reminders();
  if v_second = 0 and exists (select 1 from public.notifications where dedupe_key = 'tahsilat-yaklasiyor:' || v_b || ':' || (current_date + 2))
     and not exists (select 1 from public.notifications where dedupe_key like 'tahsilat-%' || v_a || '%') then
    passed := passed + 1;
  else
    notes := notes || ' hatirlatma';
  end if;
  -- yetkisiz hesap
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.project_cost_lines;
  if v_n = 0 and (select count(*) from public.project_receivables) = 0 then passed := passed + 1; else notes := notes || ' yetkisiz-okuma'; end if;
  begin
    insert into public.cost_rates (code, name, cost_group, unit, unit_cost) values ('UZAK', 'Sızma', 'diger', 'adet', 1);
    notes := notes || ' yetkisiz-yazma';
  exception when insufficient_privilege then passed := passed + 1; end;
  reset role;
  raise exception 'LEONX_FAZ8_TEST_SONUC basarili=%/14 sorunlar=[%]', passed, notes;
end;
$$;
