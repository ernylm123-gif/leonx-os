-- =====================================================================
-- LEONX OS — Faz 8: finans, maliyet, tahsilat ve kârlılık
-- Tek işlem içinde çalışır ve sonunda ROLLBACK yapar; kalıcı veri bırakmaz.
-- =====================================================================
begin;

select set_config('leonx.owner', (select user_id::text from public.app_owner), true);
select set_config('leonx.intruder', gen_random_uuid()::text, true);

create or replace function pg_temp.act_as(p_user text)
returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- =====================================================================
-- A) ANON
-- =====================================================================
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
declare t text;
begin
  foreach t in array array['cost_rates', 'fx_rates', 'project_budgets', 'project_cost_lines', 'project_expenses',
    'project_payment_schedule', 'project_collections', 'project_receivables'] loop
    begin
      execute format('select count(*) from public.%I', t);
      raise exception 'TEST BAŞARISIZ: anon % okuyabildi', t;
    exception when insufficient_privilege then
      raise notice 'PASS A: anon % okuyamaz', t;
    end;
  end loop;
  begin
    perform public.leonx_finance_budget_check(gen_random_uuid());
    raise exception 'TEST BAŞARISIZ: anon bütçe kontrolünü çağırdı';
  exception when insufficient_privilege then raise notice 'PASS A: anon iç finans fonksiyonunu çağıramaz';
  end;
  begin
    perform public.leonx_fx_rate('EUR', 'TRY', current_date, null);
    raise exception 'TEST BAŞARISIZ: anon kur fonksiyonunu çağırdı';
  exception when insufficient_privilege then raise notice 'PASS A: anon kur fonksiyonunu çağıramaz';
  end;
end;
$$;
reset role;

-- Tetikleyici fonksiyonları istemci rollerince doğrudan çağrılamaz (yetki kontrolü)
do $$
declare f text;
begin
  foreach f in array array['tg_fin_cost_line_guard', 'tg_fin_budget_guard', 'tg_fin_collection_guard', 'tg_fin_project_lock',
    'tg_fin_expense', 'tg_fin_collection'] loop
    if has_function_privilege('authenticated', format('public.%I()', f), 'execute')
       or has_function_privilege('anon', format('public.%I()', f), 'execute') then
      raise exception 'TEST BAŞARISIZ: % istemciye açık', f;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'public.leonx_finance_budget_check(uuid)', 'execute') then
    raise exception 'TEST BAŞARISIZ: bütçe kontrolü istemciye açık';
  end if;
  raise notice 'PASS A: finans tetikleyici ve iç fonksiyonları istemciye kapalı';
  if not exists (select 1 from pg_class where relname = 'project_receivables' and 'security_invoker=true' = any (reloptions)) then
    raise exception 'TEST BAŞARISIZ: project_receivables security_invoker değil';
  end if;
  raise notice 'PASS A: tahsilat görünümü security_invoker (RLS geçerli)';
end;
$$;

-- =====================================================================
-- B) SAHİP
-- =====================================================================
set local role authenticated;
select pg_temp.act_as(current_setting('leonx.owner'));

do $$
declare
  v_c uuid; v_p uuid; v_p2 uuid; v_tk uuid; v_tk2 uuid; v_i1 uuid; v_i2 uuid; v_q uuid; v_rate uuid; v_line public.project_cost_lines;
  v_num numeric; v_n int; v_b public.project_budgets;
begin
  insert into public.companies (name) values ('Faz8 Test Firma') returning id into v_c;
  insert into public.projects (code, name, category, company_id, stage) values ('LX-F8-1', 'Faz8 proje', 'aluminyum_dograma', v_c, 'uretimde') returning id into v_p;
  insert into public.projects (code, name, category, company_id) values ('LX-F8-2', 'Faz8 diğer proje', 'pvc_dograma', v_c) returning id into v_p2;
  perform set_config('leonx.p', v_p::text, true);
  perform set_config('leonx.p2', v_p2::text, true);

  -- Birim maliyet kataloğu
  insert into public.cost_rates (code, name, cost_group, unit, currency, unit_cost, quantity_category, valid_from)
  values ('AL-PROF', 'Alüminyum profil', 'profil', 'm2', 'TRY', 1000, 'al_pencere', current_date) returning id into v_rate;
  begin
    insert into public.cost_rates (code, name, cost_group, unit, unit_cost, valid_from) values ('AL-PROF', 'Kopya', 'profil', 'm2', 5, current_date);
    raise exception 'TEST BAŞARISIZ: aynı kod ve tarih iki kez eklendi';
  exception when unique_violation then raise notice 'PASS B: birim maliyet kodu + geçerlilik tarihi benzersiz';
  end;
  begin
    insert into public.cost_rates (code, name, cost_group, unit, unit_cost) values ('SIFIR', 'Sıfır fiyat', 'cam', 'm2', 0);
    raise exception 'TEST BAŞARISIZ: sıfır birim maliyet kabul edildi';
  exception when check_violation then raise notice 'PASS B: katalogda sıfır/uydurma varsayılan fiyat yok (birim maliyet > 0)';
  end;

  -- Sayısal hassasiyet
  insert into public.project_cost_lines (project_id, cost_group, description, quantity, unit, unit_cost, currency)
  values (v_p, 'iscilik', 'Hassasiyet testi', 1.23456, 'saat', 0.005, 'TRY') returning * into v_line;
  if v_line.quantity <> 1.235 or v_line.unit_cost <> 0.01 then
    raise exception 'TEST BAŞARISIZ: hassasiyet miktar=% birim=%', v_line.quantity, v_line.unit_cost;
  end if;
  update public.project_cost_lines set quantity = 12.345, unit_cost = 1234.56 where id = v_line.id returning * into v_line;
  if round(v_line.quantity * v_line.unit_cost, 2) <> 15240.64 or v_line.version <> 2 then
    raise exception 'TEST BAŞARISIZ: satır tutarı % sürüm %', round(v_line.quantity * v_line.unit_cost, 2), v_line.version;
  end if;
  raise notice 'PASS B: numeric(14,3) miktar, numeric(14,2) tutar; 12,345 × 1234,56 = 15240,64 (yarım yukarı); sürüm artar';

  -- Fiyatsız satır sıfır sayılmaz (boş kalır)
  insert into public.project_cost_lines (project_id, cost_group, description, quantity, unit, currency)
  values (v_p2, 'cam', 'Fiyat tanımlanmamış', 3, 'm2', 'TRY') returning * into v_line;
  if v_line.unit_cost is not null then raise exception 'TEST BAŞARISIZ: fiyatsız satır sıfırlandı'; end if;
  raise notice 'PASS B: fiyat tanımlanmamış satır boş (null) saklanır, sıfır varsayılmaz';

  -- Kurlar
  insert into public.fx_rates (rate_date, from_currency, to_currency, rate, source) values (current_date - 3, 'EUR', 'TRY', 34.1234567, 'TCMB elle girildi');
  select rate into v_num from public.fx_rates where from_currency = 'EUR' and project_id is null;
  if v_num <> 34.123457 then raise exception 'TEST BAŞARISIZ: kur hassasiyeti %', v_num; end if;
  begin
    insert into public.fx_rates (rate_date, from_currency, to_currency, rate, source) values (current_date - 3, 'EUR', 'TRY', 35, 'kopya');
    raise exception 'TEST BAŞARISIZ: aynı gün aynı genel kur iki kez';
  exception when unique_violation then raise notice 'PASS B: aynı tarih/çift/kapsam için tek kur';
  end;
  begin
    insert into public.fx_rates (rate_date, from_currency, to_currency, rate, source) values (current_date, 'TRY', 'TRY', 1, 'x');
    raise exception 'TEST BAŞARISIZ: aynı para birimine kur';
  exception when check_violation then null;
  end;
  insert into public.fx_rates (rate_date, from_currency, to_currency, rate, project_id, source) values (current_date - 10, 'EUR', 'TRY', 36.5, v_p, 'Sözleşme kuru');
  if public.leonx_fx_rate('EUR', 'TRY', current_date, v_p) <> 36.5 then raise exception 'TEST BAŞARISIZ: projeye özel kur öncelikli değil'; end if;
  if public.leonx_fx_rate('EUR', 'TRY', current_date, v_p2) <> 34.123457 then raise exception 'TEST BAŞARISIZ: genel kur seçilmedi'; end if;
  if public.leonx_fx_rate('EUR', 'TRY', current_date - 5, v_p2) is not null then raise exception 'TEST BAŞARISIZ: ileri tarihli kur kullanıldı'; end if;
  if public.leonx_fx_rate('TRY', 'EUR', current_date, v_p) is not null then raise exception 'TEST BAŞARISIZ: ters yön kendiliğinden hesaplandı'; end if;
  if public.leonx_fx_rate('USD', 'TRY', current_date, v_p) is not null then raise exception 'TEST BAŞARISIZ: girilmemiş kur uyduruldu'; end if;
  if public.leonx_fx_rate('TRY', 'TRY', current_date, v_p) <> 1 then raise exception 'TEST BAŞARISIZ: aynı birim'; end if;
  raise notice 'PASS B: kur seçimi: projeye özel > genel, tarih ≤ işlem günü, ters yön ve girilmemiş kur yok, numeric(18,6)';

  -- Metraj: taslak sürüm / doğrulanmamış poz aktarılamaz
  insert into public.quantity_takeoffs (project_id, name, revision) values (v_p, 'Uygulama', 1) returning id into v_tk;
  insert into public.quantity_items (takeoff_id, project_id, poz_code, category, width_mm, height_mm, quantity, verification)
  values (v_tk, v_p, 'P1', 'al_pencere', 1500, 2000, 4, 'onaylandi') returning id into v_i1;
  insert into public.quantity_items (takeoff_id, project_id, poz_code, category, width_mm, height_mm, quantity, verification)
  values (v_tk, v_p, 'P2', 'al_pencere', 1000, 1000, 1, 'bekliyor') returning id into v_i2;
  begin
    insert into public.project_cost_lines (project_id, cost_group, description, quantity, unit, unit_cost, source, source_takeoff_id, source_item_id)
    values (v_p, 'profil', 'P1 profil', 12, 'm2', 1000, 'metraj', v_tk, v_i1);
    raise exception 'TEST BAŞARISIZ: taslak metraj maliyete aktarıldı';
  exception when check_violation then raise notice 'PASS B: taslak (onaysız) metraj sürümü maliyete aktarılamaz';
  end;
  update public.quantity_takeoffs set status = 'onaylandi' where id = v_tk;
  insert into public.project_cost_lines (project_id, cost_group, description, quantity, unit, unit_cost, source, source_takeoff_id, source_item_id, cost_rate_id, measure_basis)
  values (v_p, 'profil', 'P1 profil', 12, 'm2', 1000, 'metraj', v_tk, v_i1, v_rate, 'alan');
  begin
    insert into public.project_cost_lines (project_id, cost_group, description, quantity, unit, unit_cost, source, source_takeoff_id, source_item_id)
    values (v_p, 'profil', 'P1 profil (tekrar)', 12, 'm2', 1000, 'metraj', v_tk, v_i1);
    raise exception 'TEST BAŞARISIZ: aynı poz aynı gruba iki kez aktarıldı';
  exception when unique_violation then raise notice 'PASS B: aynı metraj pozu aynı maliyet grubuna ikinci kez eklenemez (benzersiz indeks)';
  end;
  insert into public.project_cost_lines (project_id, cost_group, description, quantity, unit, unit_cost, source, source_takeoff_id, source_item_id, measure_basis)
  values (v_p, 'montaj', 'P1 montaj', 4, 'adet', 0, 'metraj', v_tk, v_i1, 'adet');
  begin
    insert into public.project_cost_lines (project_id, cost_group, description, quantity, unit, unit_cost, source, source_takeoff_id, source_item_id)
    values (v_p, 'profil', 'P2 profil', 1, 'm2', 1000, 'metraj', v_tk, v_i2);
    raise exception 'TEST BAŞARISIZ: doğrulanmamış poz aktarıldı';
  exception when check_violation then raise notice 'PASS B: doğrulama bekleyen poz maliyete aktarılamaz';
  end;
  begin
    insert into public.project_cost_lines (project_id, cost_group, description, quantity, unit, unit_cost, source, source_takeoff_id, source_item_id)
    values (v_p2, 'profil', 'Başka proje', 1, 'm2', 1, 'metraj', v_tk, v_i1);
    raise exception 'TEST BAŞARISIZ: başka projenin metrajı aktarıldı';
  exception when check_violation then raise notice 'PASS B: başka projenin metrajı aktarılamaz';
  end;
  begin
    insert into public.project_cost_lines (project_id, cost_group, description, quantity, unit, unit_cost, source_item_id)
    values (v_p, 'cam', 'Elle ama bağlı', 1, 'm2', 1, v_i1);
    raise exception 'TEST BAŞARISIZ: elle satırda metraj bağlantısı';
  exception when check_violation then null;
  end;
  -- Yeni revizyon onaylansa bile ikinci revizyon aynı projeye aktarılamaz (çift sayım)
  v_tk2 := public.create_takeoff_revision(v_tk, 'Revize');
  update public.quantity_takeoffs set status = 'onaylandi' where id = v_tk2;
  begin
    insert into public.project_cost_lines (project_id, cost_group, description, quantity, unit, unit_cost, source, source_takeoff_id, source_item_id)
    select v_p, 'cam', 'Rev2 P1', 12, 'm2', 500, 'metraj', v_tk2, id from public.quantity_items where takeoff_id = v_tk2 and poz_code = 'P1';
    raise exception 'TEST BAŞARISIZ: ikinci metraj revizyonu aynı projeye aktarıldı';
  exception when check_violation then raise notice 'PASS B: bir projeye iki farklı metraj revizyonu aktarılamaz (çift sayım engeli)';
  end;
  begin
    update public.project_cost_lines set project_id = v_p2 where project_id = v_p and source = 'elle';
    raise exception 'TEST BAŞARISIZ: maliyet satırı projesi değişti';
  exception when check_violation then null;
  end;

  -- Bütçe: yalnız kabul edilmiş teklif
  insert into public.quotes (company_id, project_id, title) values (v_c, v_p, 'Faz8 teklif') returning id into v_q;
  insert into public.project_budgets (project_id, currency, sale_net_amount, vat_pct) values (v_p, 'TRY', 40000, 20) returning * into v_b;
  begin
    update public.project_budgets set source_quote_id = v_q, quote_snapshot_net = 40000 where id = v_b.id;
    raise exception 'TEST BAŞARISIZ: taslak teklif bütçeye bağlandı';
  exception when check_violation then raise notice 'PASS B: bütçe yalnız kabul edilmiş teklife bağlanır';
  end;
  update public.quotes set status = 'gonderildi' where id = v_q;
  update public.quotes set status = 'kabul' where id = v_q;
  update public.project_budgets set source_quote_id = v_q, quote_snapshot_net = 40000, quote_snapshot_currency = 'TRY', quote_snapshot_at = now() where id = v_b.id;
  begin
    insert into public.project_budgets (project_id) values (v_p);
    raise exception 'TEST BAŞARISIZ: projeye ikinci bütçe';
  exception when unique_violation then raise notice 'PASS B: proje başına tek bütçe; kabul edilen teklif anlık görüntüsüyle bağlandı';
  end;
  begin
    insert into public.project_budgets (project_id, source_quote_id) values (v_p2, v_q);
    raise exception 'TEST BAŞARISIZ: başka projenin teklifi bağlandı';
  exception when check_violation then null;
  end;
  begin
    insert into public.project_budgets (project_id, vat_pct) values (v_p2, 120);
    raise exception 'TEST BAŞARISIZ: %%120 KDV';
  exception when check_violation then null;
  end;
end;
$$;

-- Bütçe aşımı: tahmini = 15240,64 + 12000 + 0 = 27240,64 TRY; eşik geçişinde bir kez bildirim
do $$
declare
  v_p uuid := current_setting('leonx.p')::uuid;
  v_n int; v_e uuid; v_line uuid;
begin
  insert into public.project_expenses (project_id, expense_date, cost_group, description, supplier, amount, vat_amount, currency, document_no, paid)
  values (v_p, current_date, 'profil', 'Profil alımı', 'Tedarikçi A', 20000, 4000, 'TRY', 'FT-1', true);
  select count(*) into v_n from public.project_events where project_id = v_p and kind = 'gider';
  if v_n <> 1 then raise exception 'TEST BAŞARISIZ: gider olayı %', v_n; end if;
  if exists (select 1 from public.notifications where kind = 'butce_asildi') then raise exception 'TEST BAŞARISIZ: aşım yokken bildirim'; end if;
  raise notice 'PASS C: gider zaman çizelgesine yazılır; bütçe içinde bildirim yok';
  begin
    insert into public.project_expenses (project_id, expense_date, cost_group, description, supplier, amount, currency, document_no)
    values (v_p, current_date, 'profil', 'Aynı fatura', 'tedarikçi a', 1, 'TRY', 'ft-1');
    raise exception 'TEST BAŞARISIZ: aynı tedarikçi belgesi iki kez';
  exception when unique_violation then raise notice 'PASS C: aynı tedarikçinin aynı belgesi iki kez gider yazılamaz';
  end;
  -- Kuru olmayan USD gider toplamaya katılmaz (uydurma çevrim yok)
  insert into public.project_expenses (project_id, expense_date, cost_group, description, amount, currency)
  values (v_p, current_date, 'aksesuar', 'USD aksesuar', 900000, 'USD');
  if exists (select 1 from public.notifications where kind = 'butce_asildi') then raise exception 'TEST BAŞARISIZ: kuru olmayan gider çevrildi'; end if;
  raise notice 'PASS C: kuru girilmemiş para birimindeki gider ana para birimine çevrilmez';
  insert into public.project_expenses (project_id, expense_date, cost_group, description, amount, currency)
  values (v_p, current_date, 'montaj', 'Montaj ekibi', 8000, 'TRY') returning id into v_e;
  insert into public.project_expenses (project_id, expense_date, cost_group, description, amount, currency)
  values (v_p, current_date, 'nakliye', 'Nakliye', 100, 'TRY');
  update public.project_expenses set paid = true where id = v_e;
  select count(*) into v_n from public.notifications where kind = 'butce_asildi' and entity_id = v_p;
  if v_n <> 1 then raise exception 'TEST BAŞARISIZ: bütçe aşımı bildirimi % (1 beklenir)', v_n; end if;
  if (select dedupe_key from public.notifications where kind = 'butce_asildi') <> 'butce-asildi:' || v_p || ':0' then raise exception 'TEST BAŞARISIZ: aşım anahtarı'; end if;
  select count(*) into v_n from public.project_events where project_id = v_p and kind = 'butce_asildi';
  if v_n <> 1 then raise exception 'TEST BAŞARISIZ: aşım olayı %', v_n; end if;
  if (select link from public.notifications where kind = 'butce_asildi') <> '/projeler/' || v_p || '?sekme=finans' then raise exception 'TEST BAŞARISIZ: aşım bağlantısı'; end if;
  raise notice 'PASS C: bütçe aşımı (28100 > 27240,64) tek bildirim + tek olay; sonraki giderler aynı eşikte tekrar üretmez';
  -- Faturadaki kur ile EUR gider (ana birime çevrilir): 100 EUR × 40 = 4000 → 32100 → eşik 1 (%17,8)
  insert into public.project_expenses (project_id, expense_date, cost_group, description, amount, currency, fx_rate_to_base, fx_to_currency)
  values (v_p, current_date, 'cam', 'Cam (EUR)', 100, 'EUR', 40, 'TRY');
  select count(*) into v_n from public.notifications where kind = 'butce_asildi' and entity_id = v_p;
  if v_n <> 2 then raise exception 'TEST BAŞARISIZ: ikinci eşik bildirimi %', v_n; end if;
  raise notice 'PASS C: faturadaki kurla çevrilen gider sayılır; yeni %%10 eşiğinde ikinci bildirim';
  -- Fiyatı tanımlanmamış satır varken tahmin eksik → yeni eşik bildirimi üretilmez
  insert into public.project_cost_lines (project_id, cost_group, description, quantity, unit, currency) values (v_p, 'aksesuar', 'Fiyatsız', 1, 'adet', 'TRY') returning id into v_line;
  insert into public.project_expenses (project_id, expense_date, cost_group, description, amount, currency) values (v_p, current_date, 'diger', 'Büyük gider', 50000, 'TRY');
  select count(*) into v_n from public.notifications where kind = 'butce_asildi' and entity_id = v_p;
  if v_n <> 2 then raise exception 'TEST BAŞARISIZ: eksik tahminle aşım bildirimi %', v_n; end if;
  raise notice 'PASS C: fiyatı tanımlanmamış satır varken (eksik tahmin) aşım bildirimi üretilmez';
  begin
    insert into public.project_expenses (project_id, expense_date, cost_group, description, amount, currency, fx_rate_to_base)
    values (v_p, current_date, 'cam', 'Kur var birim yok', 1, 'EUR', 40);
    raise exception 'TEST BAŞARISIZ: hedef birimsiz fatura kuru';
  exception when check_violation then null;
  end;
  begin
    insert into public.project_expenses (project_id, expense_date, cost_group, description, amount, currency) values (v_p, current_date, 'diger', 'Negatif', -5, 'TRY');
    raise exception 'TEST BAŞARISIZ: negatif gider';
  exception when check_violation then raise notice 'PASS C: gider tutarı pozitif; fatura kuru hedef birimle birlikte girilir';
  end;
end;
$$;

-- Ödeme planı, tahsilat (FIFO), hatırlatmalar
do $$
declare
  v_p uuid := current_setting('leonx.p')::uuid;
  v_p2 uuid := current_setting('leonx.p2')::uuid;
  v_a uuid; v_b uuid; v_cc uuid; v_d uuid; v_x uuid; v_n int; v_first int; v_second int; r record;
begin
  insert into public.project_payment_schedule (project_id, kind, label, due_date, amount, currency, sort_order)
  values (v_p, 'pesinat', 'Peşinat', current_date - 10, 1000, 'TRY', 1) returning id into v_a;
  insert into public.project_payment_schedule (project_id, kind, label, due_date, amount, currency, sort_order)
  values (v_p, 'ara_odeme', 'Ara ödeme', current_date + 2, 2000, 'TRY', 2) returning id into v_b;
  insert into public.project_payment_schedule (project_id, kind, label, due_date, amount, currency, sort_order)
  values (v_p, 'son_odeme', 'Son ödeme', current_date + 40, 500, 'TRY', 3) returning id into v_cc;
  insert into public.project_payment_schedule (project_id, kind, label, due_date, amount, currency, sort_order)
  values (v_p2, 'taksit', 'Başka proje', current_date, 10, 'EUR', 1) returning id into v_x;
  -- Bağlanmamış 1200 TRY: en eski açık taksitten başlayarak dağıtılır
  insert into public.project_collections (project_id, received_date, amount, currency, method) values (v_p, current_date - 1, 1200, 'TRY', 'havale');
  select * into r from public.project_receivables where id = v_a;
  if r.collected <> 1000 or r.outstanding <> 0 or r.status <> 'tahsil_edildi' then raise exception 'TEST BAŞARISIZ: A % % %', r.collected, r.outstanding, r.status; end if;
  select * into r from public.project_receivables where id = v_b;
  if r.collected <> 200 or r.outstanding <> 1800 or r.status <> 'kismi' then raise exception 'TEST BAŞARISIZ: B % % %', r.collected, r.outstanding, r.status; end if;
  select * into r from public.project_receivables where id = v_cc;
  if r.collected <> 0 or r.status <> 'bekliyor' then raise exception 'TEST BAŞARISIZ: C %', r.status; end if;
  raise notice 'PASS D: bağlanmamış tahsilat en eski açık taksitlere sırayla dağıtılır (tahsil edildi / kısmi / bekliyor)';
  -- Taksite bağlı fazla ödeme negatif kalan üretmez; fazlası sıradaki taksite geçer
  insert into public.project_collections (project_id, received_date, amount, currency, method, schedule_id) values (v_p, current_date, 2500, 'TRY', 'cek', v_cc);
  select * into r from public.project_receivables where id = v_cc;
  if r.outstanding <> 0 or r.collected <> 500 then raise exception 'TEST BAŞARISIZ: fazla ödeme C % %', r.collected, r.outstanding; end if;
  select * into r from public.project_receivables where id = v_b;
  if r.outstanding <> 0 or r.status <> 'tahsil_edildi' then raise exception 'TEST BAŞARISIZ: fazla ödeme B % %', r.outstanding, r.status; end if;
  raise notice 'PASS D: taksiti aşan ödeme negatif kalan üretmez, fazlası açık taksite aktarılır';
  begin
    insert into public.project_collections (project_id, received_date, amount, currency, schedule_id) values (v_p, current_date, 5, 'EUR', v_b);
    raise exception 'TEST BAŞARISIZ: farklı para biriminde taksite tahsilat';
  exception when check_violation then raise notice 'PASS D: tahsilat bağlandığı taksitle aynı para biriminde olmalı';
  end;
  begin
    insert into public.project_collections (project_id, received_date, amount, currency, schedule_id) values (v_p, current_date, 5, 'EUR', v_x);
    raise exception 'TEST BAŞARISIZ: başka projenin taksitine tahsilat';
  exception when check_violation then null;
  end;
  select count(*) into v_n from public.project_events where project_id = v_p and kind = 'tahsilat';
  if v_n <> 2 then raise exception 'TEST BAŞARISIZ: tahsilat olayı %', v_n; end if;
  raise notice 'PASS D: tahsilatlar zaman çizelgesine yazılır';

  -- Hatırlatmalar: vadesi geçmiş (5 gün önce) ve yaklaşan (3 gün) yeni taksitler
  insert into public.project_payment_schedule (project_id, kind, label, due_date, amount, currency, sort_order)
  values (v_p, 'taksit', 'Geciken taksit', current_date - 5, 3000, 'TRY', 4) returning id into v_d;
  insert into public.project_payment_schedule (project_id, kind, label, due_date, amount, currency, sort_order)
  values (v_p, 'taksit', 'Yaklaşan taksit', current_date + 3, 300, 'USD', 5);
  -- FIFO vade sırasıyla: havuz 3200 TRY → A 1000, geciken taksit 2200 (kalan 800), ara ödeme 0 (kalan 2000)
  select * into r from public.project_receivables where id = v_d;
  if r.outstanding <> 800 or r.status <> 'gecikti' then raise exception 'TEST BAŞARISIZ: geciken taksit % %', r.outstanding, r.status; end if;
  select * into r from public.project_receivables where id = v_b;
  if r.outstanding <> 2000 or r.status <> 'bekliyor' then raise exception 'TEST BAŞARISIZ: yeniden dağıtım B % %', r.outstanding, r.status; end if;
  if exists (select 1 from public.project_receivables where outstanding < 0) then raise exception 'TEST BAŞARISIZ: negatif kalan'; end if;
  raise notice 'PASS D: dağıtım vade sırasına göre (eski vade önce); kısmi ödenmiş vadesi geçmiş taksit "gecikti"';
  v_first := public.check_reminders();
  v_second := public.check_reminders();
  select count(*) into v_n from public.notifications where kind = 'tahsilat_gecikti';
  if v_n <> 1 or not exists (select 1 from public.notifications where dedupe_key = 'tahsilat-gecikti:' || v_d) then raise exception 'TEST BAŞARISIZ: gecikme bildirimi %', v_n; end if;
  -- Yaklaşan: ara ödeme (2 gün, TRY), USD taksiti (3 gün), başka projenin bugün vadeli EUR taksiti
  select count(*) into v_n from public.notifications where kind = 'tahsilat_yaklasiyor';
  if v_n <> 3 or not exists (select 1 from public.notifications where dedupe_key = 'tahsilat-yaklasiyor:' || v_b || ':' || (current_date + 2)) then
    raise exception 'TEST BAŞARISIZ: yaklaşan tahsilat bildirimi %', v_n;
  end if;
  if exists (select 1 from public.notifications where kind like 'tahsilat%' and (dedupe_key like '%' || v_a || '%' or dedupe_key like '%' || v_cc || '%')) then
    raise exception 'TEST BAŞARISIZ: tahsil edilmiş taksit için hatırlatma';
  end if;
  if v_second <> 0 then raise exception 'TEST BAŞARISIZ: hatırlatma tekrarlandı (% yeni)', v_second; end if;
  if (select category from public.notifications where kind = 'tahsilat_gecikti') <> 'termin' or (select actor from public.notifications where kind = 'tahsilat_gecikti') is not null then
    raise exception 'TEST BAŞARISIZ: tahsilat bildirimi kategori/sistem';
  end if;
  raise notice 'PASS D: tahsilat yaklaşıyor/gecikti bildirimleri bir kez (termin, sistem); ödenmiş taksit için yok; ikinci tarama 0 yeni';
end;
$$;
reset role;

-- =====================================================================
-- E) YETKİSİZ HESAP
-- =====================================================================
set local role authenticated;
select pg_temp.act_as(current_setting('leonx.intruder'));
do $$
declare t text; v_n int;
begin
  foreach t in array array['cost_rates', 'fx_rates', 'project_budgets', 'project_cost_lines', 'project_expenses',
    'project_payment_schedule', 'project_collections', 'project_receivables'] loop
    execute format('select count(*) from public.%I', t) into v_n;
    if v_n <> 0 then raise exception 'TEST BAŞARISIZ: yetkisiz hesap % içinde % satır gördü', t, v_n; end if;
  end loop;
  raise notice 'PASS E: yetkisiz hesap hiçbir finans verisini (görünüm dahil) göremez';
  begin
    insert into public.cost_rates (code, name, cost_group, unit, unit_cost) values ('SIZMA', 'Sızma', 'diger', 'adet', 1);
    raise exception 'TEST BAŞARISIZ: yetkisiz hesap birim maliyet ekledi';
  exception when insufficient_privilege then raise notice 'PASS E: yetkisiz hesap birim maliyet ekleyemez';
  end;
  begin
    insert into public.project_expenses (project_id, expense_date, cost_group, description, amount) values (current_setting('leonx.p')::uuid, current_date, 'diger', 'Sızma', 1);
    raise exception 'TEST BAŞARISIZ: yetkisiz hesap gider ekledi';
  exception when insufficient_privilege then raise notice 'PASS E: yetkisiz hesap gider ekleyemez';
  end;
  update public.project_budgets set sale_net_amount = 1;
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'TEST BAŞARISIZ: yetkisiz hesap bütçe değiştirdi'; end if;
  raise notice 'PASS E: yetkisiz hesap bütçe değiştiremez';
end;
$$;
reset role;

-- Sahip: kalıcı veri değişmeden kaldı (aşağıdaki ROLLBACK ile hepsi geri alınır)
do $$ begin raise notice 'TESTLER BAŞARILI (finance)'; end $$;
rollback;
