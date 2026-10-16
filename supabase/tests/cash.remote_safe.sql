-- =====================================================================
-- LEONX OS — 013 kasa/banka: gerçek Supabase için SİLME İÇERMEYEN test alt kümesi
-- Tek işlem içindedir ve sonunda bilerek hata verir: tüm değişiklikler GERİ ALINIR.
-- Sonuç hata iletisinde "LEONX_KASA_TEST_SONUC" ile döner. (Tam test: cash.test.sql)
-- =====================================================================
do $$
declare
  v_owner text := (select user_id::text from public.app_owner);
  v_kasa uuid; v_banka uuid; v_gelir uuid; v_gider uuid; v_e uuid; v_t uuid; v_r uuid; v_n int; v_b numeric;
  passed int := 0; notes text := '';
begin
  if v_owner is null then raise exception 'Sahip tanımlı değil'; end if;
  -- katalog (salt okunur)
  if (select count(*) from public.finance_categories where is_system) = 15 then passed := passed + 1; else notes := notes || ' sistem-kategori'; end if;
  if exists (select 1 from pg_class where relname = 'finance_ledger' and 'security_invoker=true' = any (reloptions))
     and exists (select 1 from pg_class where relname = 'finance_account_balances' and 'security_invoker=true' = any (reloptions)) then
    passed := passed + 1;
  else
    notes := notes || ' gorunum-invoker';
  end if;
  if not has_table_privilege('authenticated', 'public.finance_audit_log', 'insert') and not has_function_privilege('authenticated', 'public.tg_fin_audit()', 'execute') then
    passed := passed + 1;
  else
    notes := notes || ' gecmis-yetki';
  end if;
  -- anon
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  begin perform count(*) from public.finance_ledger; notes := notes || ' anon-defter';
  exception when insufficient_privilege then passed := passed + 1; end;
  reset role;
  -- sahip
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select id into v_gelir from public.finance_categories where kind = 'gelir' and key = 'hizmet';
  select id into v_gider from public.finance_categories where kind = 'gider' and key = 'kira';
  insert into public.finance_accounts (name, kind, currency, opening_balance) values ('Uzak test kasası ' || gen_random_uuid(), 'kasa', 'TRY', 1000) returning id into v_kasa;
  insert into public.finance_accounts (name, kind, currency) values ('Uzak test bankası ' || gen_random_uuid(), 'banka', 'TRY') returning id into v_banka;
  insert into public.finance_entries (kind, entry_date, amount, vat_amount, currency, category_id, account_id, description)
  values ('gelir', current_date, 500, 100, 'TRY', v_gelir, v_kasa, 'Uzak gelir') returning id into v_e;
  insert into public.finance_entries (kind, entry_date, amount, currency, category_id, status, description)
  values ('gider', current_date, 9999, 'TRY', v_gider, 'bekliyor', 'Uzak bekleyen');
  select balance into v_b from public.finance_account_balances where account_id = v_kasa;
  if v_b = 1600 then passed := passed + 1; else notes := notes || ' bakiye:' || v_b; end if;
  insert into public.finance_transfers (transfer_date, from_account_id, to_account_id, from_amount, to_amount) values (current_date, v_kasa, v_banka, 300, 300) returning id into v_t;
  if (select balance from public.finance_account_balances where account_id = v_kasa) = 1300
     and (select balance from public.finance_account_balances where account_id = v_banka) = 300 then passed := passed + 1; else notes := notes || ' virman'; end if;
  begin
    insert into public.finance_entries (kind, entry_date, amount, currency, category_id, account_id, description) values ('gelir', current_date, 1, 'EUR', v_gelir, v_kasa, 'x');
    notes := notes || ' para-birimi';
  exception when check_violation then passed := passed + 1; end;
  begin
    insert into public.finance_entries (kind, entry_date, amount, currency, category_id, account_id, description) values ('gelir', current_date, 1, 'TRY', v_gider, v_kasa, 'x');
    notes := notes || ' kategori';
  exception when check_violation then passed := passed + 1; end;
  update public.finance_entries set voided_at = now(), voided_reason = 'Uzak test' where id = v_e;
  if (select balance from public.finance_account_balances where account_id = v_kasa) = 700 then passed := passed + 1; else notes := notes || ' iptal'; end if;
  if (select count(*) from public.finance_audit_log where row_id = v_e and action in ('insert', 'void')) = 2 then passed := passed + 1; else notes := notes || ' gecmis'; end if;
  insert into public.finance_recurring (kind, description, amount, currency, category_id, frequency, start_date)
  values ('gider', 'Uzak düzenli', 10, 'TRY', v_gider, 'aylik', current_date - 40) returning id into v_r;
  v_n := public.leonx_finance_generate_recurring(null);
  if public.leonx_finance_generate_recurring(null) = 0 and (select count(*) from public.finance_entries where recurring_id = v_r) = 2 then passed := passed + 1; else notes := notes || ' duzenli'; end if;
  -- yetkisiz hesap
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  if (select count(*) from public.finance_ledger) = 0 and (select count(*) from public.finance_accounts) = 0 then passed := passed + 1; else notes := notes || ' yetkisiz-okuma'; end if;
  reset role;
  raise exception 'LEONX_KASA_TEST_SONUC basarili=%/12 sorunlar=[%]', passed, notes;
end;
$$;
