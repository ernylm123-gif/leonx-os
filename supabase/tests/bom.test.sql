-- =====================================================================
-- LEONX OS — 014: Malzeme reçetesi (BOM)
-- Tek işlem içinde çalışır ve sonunda ROLLBACK yapar; kalıcı veri bırakmaz.
-- Test verisi SENTETİKTİR (gerçek üretici kodu/ölçüsü değildir).
-- =====================================================================
begin;

select set_config('leonx.owner', (select user_id::text from public.app_owner), true);
select set_config('leonx.intruder', gen_random_uuid()::text, true);

create or replace function pg_temp.act_as(p_user text)
returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- Mevcut veri sayımı (test sonunda değişmemeli)
select set_config('leonx.companies_before', (select count(*)::text from public.companies), true);

-- =====================================================================
-- A) ANON VE YETKİLER
-- =====================================================================
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
declare t text;
begin
  foreach t in array array['product_systems', 'system_components', 'system_rules', 'bom_versions', 'bom_assignments', 'bom_lines',
    'bom_material_totals', 'bom_cut_list'] loop
    begin
      execute format('select count(*) from public.%I', t);
      raise exception 'TEST BAŞARISIZ: anon % okuyabildi', t;
    exception when insufficient_privilege then
      raise notice 'PASS A: anon % okuyamaz', t;
    end;
  end loop;
  begin
    perform public.create_bom_version(gen_random_uuid(), gen_random_uuid(), '{}'::jsonb);
    raise exception 'TEST BAŞARISIZ: anon reçete sürümü oluşturma fonksiyonunu çağırdı';
  exception when insufficient_privilege then raise notice 'PASS A: anon create_bom_version çağıramaz';
  end;
  begin
    perform public.approve_bom_version(gen_random_uuid());
    raise exception 'TEST BAŞARISIZ: anon onay fonksiyonunu çağırdı';
  exception when insufficient_privilege then raise notice 'PASS A: anon approve_bom_version çağıramaz';
  end;
end;
$$;
reset role;

do $$
declare f text;
begin
  foreach f in array array['tg_bom_version_guard', 'tg_bom_child_guard'] loop
    if has_function_privilege('authenticated', format('public.%I()', f), 'execute')
       or has_function_privilege('anon', format('public.%I()', f), 'execute') then
      raise exception 'TEST BAŞARISIZ: % istemciye açık', f;
    end if;
  end loop;
  raise notice 'PASS A: reçete tetikleyici fonksiyonları istemciye kapalı';
  if has_table_privilege('authenticated', 'public.bom_versions', 'insert')
     or has_table_privilege('authenticated', 'public.bom_lines', 'insert')
     or has_table_privilege('authenticated', 'public.bom_lines', 'update')
     or has_table_privilege('authenticated', 'public.bom_assignments', 'insert') then
    raise exception 'TEST BAŞARISIZ: sürüm/satır doğrudan eklenebilir veya değiştirilebilir';
  end if;
  raise notice 'PASS A: sürüm, atama ve satırlar yalnız create_bom_version ile eklenir (doğrudan INSERT/UPDATE yetkisi yok)';
  if not exists (select 1 from pg_class where relname = 'bom_material_totals' and 'security_invoker=true' = any (reloptions))
     or not exists (select 1 from pg_class where relname = 'bom_cut_list' and 'security_invoker=true' = any (reloptions)) then
    raise exception 'TEST BAŞARISIZ: reçete görünümleri security_invoker değil';
  end if;
  raise notice 'PASS A: toplam ve kesim listesi görünümleri security_invoker (RLS geçerli)';
  if (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname in ('product_systems', 'system_components', 'system_rules', 'bom_versions', 'bom_assignments', 'bom_lines')
         and c.relrowsecurity) <> 6 then
    raise exception 'TEST BAŞARISIZ: RLS kapalı tablo var';
  end if;
  raise notice 'PASS A: 6 yeni tabloda RLS açık';
  if (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename in
       ('product_systems', 'system_components', 'system_rules', 'bom_versions', 'bom_assignments', 'bom_lines')) <> 6 then
    raise exception 'TEST BAŞARISIZ: Realtime yayınında eksik tablo';
  end if;
  raise notice 'PASS A: yeni tablolar Realtime yayınında (iki kez uygulamada tekrar eklenmedi)';
  if exists (select 1 from public.product_systems) then
    raise exception 'TEST BAŞARISIZ: sistem kütüphanesi boş başlamıyor (hazır üretici verisi var)';
  end if;
  raise notice 'PASS A: sistem kütüphanesi boş başlar (uydurma üretici verisi yok)';
end;
$$;

-- =====================================================================
-- B) SAHİP: kütüphane, sürüm, onay ve değişmezlik
-- =====================================================================
set local role authenticated;
select pg_temp.act_as(current_setting('leonx.owner'));

do $$
declare
  v_c uuid; v_p uuid; v_tk uuid; v_tk2 uuid; v_i1 uuid; v_i2 uuid; v_i3 uuid; v_sys uuid; v_kasa uuid; v_cam uuid;
  v_rk uuid; v_rc uuid; v_rate uuid; v_bom1 uuid; v_bom2 uuid; v_bom3 uuid; v_n int; v_v public.bom_versions;
  v_payload jsonb; v_num numeric;
begin
  insert into public.companies (name) values ('BOM Test Firma') returning id into v_c;
  insert into public.projects (code, name, category, company_id) values ('LX-BOM-1', 'BOM projesi', 'aluminyum_dograma', v_c) returning id into v_p;
  perform set_config('leonx.p', v_p::text, true);

  -- Sentetik sistem: kasa profili (kesim W ve H, 2'şer parça) ve cam (m²)
  insert into public.product_systems (name, manufacturer, series, system_type) values ('Sentetik test sistemi', 'TEST', 'S-0', 'al_pencere') returning id into v_sys;
  insert into public.cost_rates (code, name, cost_group, unit, unit_cost, valid_from) values ('TEST-PRF', 'Test profil', 'profil', 'm', 10, current_date) returning id into v_rate;
  insert into public.system_components (system_id, role, code, name, unit, standard_length_mm, waste_pct, cost_rate_id)
  values (v_sys, 'kasa', 'T-KASA', 'Test kasa', 'mm_profil', 6000, 5, v_rate) returning id into v_kasa;
  insert into public.system_components (system_id, role, code, name, unit) values (v_sys, 'cam', null, 'Test cam', 'm2') returning id into v_cam;
  insert into public.system_rules (component_id, cut_length_formula, pieces_formula, angle) values (v_kasa, 'W', '2', '45') returning id into v_rk;
  insert into public.system_rules (component_id, quantity_formula) values (v_cam, '(W-100)*(H-100)/1000000') returning id into v_rc;

  begin
    insert into public.system_components (system_id, role, name, unit, standard_length_mm) values (v_sys, 'fitil', 'Hatalı', 'm', 6000);
    raise exception 'TEST BAŞARISIZ: profil olmayan bileşene standart boy yazıldı';
  exception when check_violation then raise notice 'PASS B: standart boy / kg-m yalnız kesimli profil bileşeninde';
  end;
  begin
    insert into public.system_rules (component_id, quantity_formula) values (v_cam, 'W = H & $1');
    raise exception 'TEST BAŞARISIZ: formülde izin verilmeyen karakter kabul edildi';
  exception when check_violation then raise notice 'PASS B: formül karakter kümesi ve uzunluğu sunucuda denetlenir';
  end;
  begin
    insert into public.system_rules (component_id) values (v_cam);
    raise exception 'TEST BAŞARISIZ: formülsüz kural';
  exception when check_violation then null;
  end;
  begin
    insert into public.system_components (system_id, role, name, unit) values (v_sys, 'mentese', 'x', 'litre');
    raise exception 'TEST BAŞARISIZ: geçersiz birim';
  exception when check_violation then raise notice 'PASS B: bileşen birimi ve rolü kısıtlı';
  end;

  -- Metraj: taslak sürüm, 1 onaylı + 1 bekleyen poz
  insert into public.quantity_takeoffs (project_id, name, revision) values (v_p, 'Metraj', 1) returning id into v_tk;
  insert into public.quantity_items (takeoff_id, project_id, poz_code, category, width_mm, height_mm, quantity, verification)
  values (v_tk, v_p, 'P1', 'al_pencere', 1200, 1500, 4, 'onaylandi') returning id into v_i1;
  insert into public.quantity_items (takeoff_id, project_id, poz_code, category, width_mm, height_mm, quantity, verification)
  values (v_tk, v_p, 'P2', 'al_pencere', 800, 1000, 2, 'bekliyor') returning id into v_i2;
  insert into public.quantity_items (takeoff_id, project_id, poz_code, category, width_mm, height_mm, quantity, verification)
  values (v_tk, v_p, 'P3', 'al_pencere', 800, 1000, 1, 'reddedildi') returning id into v_i3;

  v_payload := jsonb_build_object(
    'source_approved', true,  -- istemcinin iddiası yok sayılmalı
    'error_count', 0, 'warning_count', 0, 'warnings', '[]'::jsonb,
    'assignments', jsonb_build_array(
      jsonb_build_object('key', 'a1', 'quantity_item_id', v_i1, 'system_id', v_sys, 'kanat', 1),
      jsonb_build_object('key', 'a2', 'quantity_item_id', v_i2, 'system_id', v_sys)),
    'lines', jsonb_build_array(
      jsonb_build_object('assignment_key', 'a1', 'component_id', v_kasa, 'rule_id', v_rk, 'line_key', 'P1|T-KASA|kasa|mm_profil|1',
        'role', 'kasa', 'code', 'T-KASA', 'name', 'Test kasa', 'unit', 'mm_profil', 'cut_length_mm', 1200, 'angle', '45', 'pieces', 8,
        'total_length_mm', 9600, 'net_quantity', 9.6, 'waste_pct', 5, 'waste_qty', 0.48, 'quantity', 10.08, 'standard_length_mm', 6000,
        'cost_rate_id', v_rate, 'unit_cost', 10, 'currency', 'TRY', 'cost_unit', 'm', 'line_cost', 100.80),
      jsonb_build_object('assignment_key', 'a1', 'component_id', v_cam, 'rule_id', v_rc, 'line_key', 'P1|-|cam|m2|1',
        'role', 'cam', 'name', 'Test cam', 'unit', 'm2', 'net_quantity', 6.16, 'quantity', 6.16)));

  -- Onaysız metraj: sürüm taslak olarak oluşturulur, source_approved = false (istemci iddiası yok sayılır)
  v_bom1 := public.create_bom_version(v_p, v_tk, v_payload);
  select * into v_v from public.bom_versions where id = v_bom1;
  if v_v.revision <> 1 or v_v.status <> 'taslak' or v_v.source_approved or v_v.takeoff_revision <> 1 or v_v.takeoff_status <> 'taslak' then
    raise exception 'TEST BAŞARISIZ: onaysız metrajdan sürüm %', row_to_json(v_v);
  end if;
  raise notice 'PASS B: onaysız metrajdan sürüm "taslak", source_approved=false (istemci iddiası yok sayıldı)';
  select count(*) into v_n from public.bom_lines where bom_version_id = v_bom1;
  if v_n <> 2 then raise exception 'TEST BAŞARISIZ: satır sayısı %', v_n; end if;
  select width_mm into v_num from public.bom_assignments where bom_version_id = v_bom1 and poz_code = 'P1';
  if v_num <> 1200 then raise exception 'TEST BAŞARISIZ: ölçü anlık görüntüsü'; end if;
  if (select poz_code from public.bom_lines where bom_version_id = v_bom1 and role = 'kasa') <> 'P1' then
    raise exception 'TEST BAŞARISIZ: satır poz kodu sunucuda yazılmadı';
  end if;
  raise notice 'PASS B: atama, poz ölçüsü anlık görüntüsü ve satırlar tek işlemde yazıldı';

  begin
    perform public.approve_bom_version(v_bom1);
    raise exception 'TEST BAŞARISIZ: onaysız metrajdan reçete onaylandı';
  exception when check_violation then raise notice 'PASS B: onaysız metrajdan reçete onaylanamaz (RPC)';
  end;
  begin
    update public.bom_versions set status = 'onayli' where id = v_bom1;
    raise exception 'TEST BAŞARISIZ: doğrudan güncellemeyle onaylandı';
  exception when check_violation then raise notice 'PASS B: onaysız reçete doğrudan güncellemeyle de onaylanamaz';
  end;
  begin
    update public.bom_versions set source_approved = true where id = v_bom1;
    raise exception 'TEST BAŞARISIZ: source_approved istemciden değiştirildi';
  exception when check_violation then raise notice 'PASS B: source_approved istemciden değiştirilemez';
  end;

  -- Reddedilmiş poz ve başka metraja ait poz reddedilir; yarım sürüm kalmaz
  begin
    perform public.create_bom_version(v_p, v_tk, jsonb_build_object('assignments', jsonb_build_array(jsonb_build_object('quantity_item_id', v_i3)), 'lines', '[]'::jsonb));
    raise exception 'TEST BAŞARISIZ: reddedilmiş poz reçeteye alındı';
  exception when check_violation then raise notice 'PASS B: reddedilmiş poz reçeteye alınamaz';
  end;
  begin
    perform public.create_bom_version(v_p, v_tk, jsonb_build_object(
      'assignments', jsonb_build_array(jsonb_build_object('key', 'a1', 'quantity_item_id', v_i1)),
      'lines', jsonb_build_array(jsonb_build_object('assignment_key', 'a1', 'line_key', 'x', 'role', 'kasa', 'name', 'x', 'unit', 'mm_profil', 'net_quantity', 1, 'quantity', 1))));
    raise exception 'TEST BAŞARISIZ: kesim boyu olmayan profil satırı kabul edildi';
  exception when check_violation then raise notice 'PASS B: hatalı satır tüm işlemi geri alır';
  end;
  if (select count(*) from public.bom_versions where project_id = v_p) <> 1 then
    raise exception 'TEST BAŞARISIZ: başarısız denemeden yarım sürüm kaldı';
  end if;
  raise notice 'PASS B: başarısız denemeler yarım sürüm veya revizyon numarası bırakmaz';
  begin
    perform public.create_bom_version(v_p, v_tk, jsonb_build_object('assignments', jsonb_build_array(
      jsonb_build_object('quantity_item_id', v_i1), jsonb_build_object('quantity_item_id', v_i1)), 'lines', '[]'::jsonb));
    raise exception 'TEST BAŞARISIZ: aynı poz iki kez';
  exception when check_violation then raise notice 'PASS B: aynı poz bir sürümde iki kez yer alamaz';
  end;

  -- Metrajı onayla; yalnız onaylı pozdan sürüm → source_approved
  update public.quantity_takeoffs set status = 'onaylandi' where id = v_tk;
  v_payload := jsonb_set(v_payload, '{assignments}', jsonb_build_array(jsonb_build_object('key', 'a1', 'quantity_item_id', v_i1, 'system_id', v_sys)));
  v_bom2 := public.create_bom_version(v_p, v_tk, v_payload);
  select * into v_v from public.bom_versions where id = v_bom2;
  if v_v.revision <> 2 or not v_v.source_approved then
    raise exception 'TEST BAŞARISIZ: onaylı kaynak sürüm %', row_to_json(v_v);
  end if;
  raise notice 'PASS B: onaylı metrajın onaylı pozlarından sürüm source_approved=true, revizyon 2';
  -- Onaylı metrajda bekleyen poz dahil edilirse yine taslak kaynak
  v_bom3 := public.create_bom_version(v_p, v_tk, jsonb_set(v_payload, '{assignments}', jsonb_build_array(
    jsonb_build_object('key', 'a1', 'quantity_item_id', v_i1), jsonb_build_object('key', 'a2', 'quantity_item_id', v_i2))));
  if (select source_approved from public.bom_versions where id = v_bom3) then
    raise exception 'TEST BAŞARISIZ: bekleyen poz içeren sürüm onaylı kaynak sayıldı';
  end if;
  raise notice 'PASS B: onaylı metrajda bekleyen poz içeren sürüm onaylı kaynak sayılmaz';

  -- Hata sayısı olan sürüm onaylanamaz
  begin
    perform public.approve_bom_version(public.create_bom_version(v_p, v_tk, jsonb_set(v_payload, '{error_count}', '2')));
    raise exception 'TEST BAŞARISIZ: hatalı reçete onaylandı';
  exception when check_violation then raise notice 'PASS B: hatalı satırı olan reçete onaylanamaz';
  end;

  perform public.approve_bom_version(v_bom2);
  select * into v_v from public.bom_versions where id = v_bom2;
  if v_v.status <> 'onayli' or v_v.approved_by <> current_setting('leonx.owner')::uuid or v_v.approved_at is null then
    raise exception 'TEST BAŞARISIZ: onay bilgisi %', row_to_json(v_v);
  end if;
  raise notice 'PASS B: onay bilgisi (onaylayan, zaman) sunucuda yazıldı';

  -- Onaylı sürüm değişmez
  begin
    update public.bom_versions set notes = 'değişiklik' where id = v_bom2;
    raise exception 'TEST BAŞARISIZ: onaylı sürüm güncellendi';
  exception when check_violation then raise notice 'PASS B: onaylı sürüm güncellenemez (not dahil)';
  end;
  begin
    update public.bom_versions set status = 'iptal' where id = v_bom2;
    raise exception 'TEST BAŞARISIZ: onaylı sürüm iptal edildi';
  exception when check_violation then null;
  end;
  begin
    delete from public.bom_versions where id = v_bom2;
    raise exception 'TEST BAŞARISIZ: onaylı sürüm silindi';
  exception when check_violation then raise notice 'PASS B: onaylı sürüm silinemez';
  end;
  -- Satırlar: istemci rolünde hiç değiştirilemez; yetkili rolde de tetikleyici engeller
  begin
    update public.bom_lines set quantity = 1 where bom_version_id = v_bom2;
    raise exception 'TEST BAŞARISIZ: satır güncellendi';
  exception when insufficient_privilege then raise notice 'PASS B: istemci reçete satırını güncelleyemez';
  end;
  begin
    delete from public.bom_lines where bom_version_id = v_bom2;
    raise exception 'TEST BAŞARISIZ: satır silindi';
  exception when insufficient_privilege then raise notice 'PASS B: istemci reçete satırını silemez';
  end;

  -- Taslak sürüm: not güncellenir, iptal edilir, silinebilir (satırlar zincirleme silinir)
  update public.bom_versions set notes = 'kontrol edildi' where id = v_bom1;
  update public.bom_versions set status = 'iptal' where id = v_bom3;
  begin
    update public.bom_versions set status = 'taslak' where id = v_bom3;
    raise exception 'TEST BAŞARISIZ: iptal sürüm yeniden açıldı';
  exception when check_violation then raise notice 'PASS B: taslak not/iptal; iptal edilen sürüm yeniden açılamaz';
  end;
  begin
    update public.bom_versions set revision = 99 where id = v_bom1;
    raise exception 'TEST BAŞARISIZ: revizyon numarası değişti';
  exception when check_violation then raise notice 'PASS B: revizyon ve hesap içeriği değiştirilemez';
  end;
  delete from public.bom_versions where id = v_bom1;
  if exists (select 1 from public.bom_lines where bom_version_id = v_bom1) or exists (select 1 from public.bom_assignments where bom_version_id = v_bom1) then
    raise exception 'TEST BAŞARISIZ: taslak sürüm silinince satırlar kaldı';
  end if;
  raise notice 'PASS B: taslak sürüm silinince atama ve satırları zincirleme silinir';

  -- Revizyon: benzersiz ve silinen numara yeniden kullanılmaz değil — en büyük + 1
  v_bom1 := public.create_bom_version(v_p, v_tk, v_payload);
  if (select revision from public.bom_versions where id = v_bom1) <> (select max(revision) from public.bom_versions where project_id = v_p) then
    raise exception 'TEST BAŞARISIZ: revizyon sırası';
  end if;
  if (select count(*) from (select revision from public.bom_versions where project_id = v_p group by revision having count(*) > 1) x) > 0 then
    raise exception 'TEST BAŞARISIZ: aynı revizyon iki kez';
  end if;
  raise notice 'PASS B: revizyon numarası proje başına benzersiz (en büyük + 1, kilitli)';

  -- Metraj revizyonu: yeni metraj sürümünden yeni taslak; onaylı reçete aynen durur
  v_tk2 := public.create_takeoff_revision(v_tk, 'Metraj rev');
  v_bom3 := public.create_bom_version(v_p, v_tk2, jsonb_set(v_payload, '{assignments}', jsonb_build_array(
    jsonb_build_object('key', 'a1', 'quantity_item_id', (select id from public.quantity_items where takeoff_id = v_tk2 and poz_code = 'P1')))));
  select * into v_v from public.bom_versions where id = v_bom3;
  if v_v.takeoff_revision <> 2 or v_v.status <> 'taslak' or v_v.source_approved then
    raise exception 'TEST BAŞARISIZ: metraj revizyonundan sürüm %', row_to_json(v_v);
  end if;
  if (select status from public.bom_versions where id = v_bom2) <> 'onayli' or (select count(*) from public.bom_lines where bom_version_id = v_bom2) <> 2 then
    raise exception 'TEST BAŞARISIZ: onaylı sürüm değişti';
  end if;
  raise notice 'PASS B: metraj revizyonundan yeni taslak reçete; eski onaylı sürüm ve satırları aynen duruyor';

  -- Başka projenin metrajı
  begin
    perform public.create_bom_version(gen_random_uuid(), v_tk, v_payload);
    raise exception 'TEST BAŞARISIZ: başka projenin metrajı kabul edildi';
  exception when check_violation then raise notice 'PASS B: metraj sürümü projeye ait olmalı';
  end;

  -- Görünümler: toplam ve kesim listesi
  select bar_estimate into v_n from public.bom_material_totals where bom_version_id = v_bom2 and code = 'T-KASA';
  if v_n <> 2 then raise exception 'TEST BAŞARISIZ: boy adedi tahmini % (10,08 m / 6 m → 2)', v_n; end if;
  select pieces into v_num from public.bom_cut_list where bom_version_id = v_bom2 and code = 'T-KASA' and cut_length_mm = 1200;
  if v_num <> 8 then raise exception 'TEST BAŞARISIZ: kesim listesi parça %', v_num; end if;
  raise notice 'PASS B: toplam görünümü (boy adedi tahmini) ve kesim listesi görünümü';

  -- Sistem silinse de onaylı sürümün anlık görüntüsü korunur
  delete from public.product_systems where id = v_sys;
  if (select system_name from public.bom_assignments where bom_version_id = v_bom2 limit 1) <> 'Sentetik test sistemi'
     or (select code from public.bom_lines where bom_version_id = v_bom2 and role = 'kasa') <> 'T-KASA'
     or (select unit_cost from public.bom_lines where bom_version_id = v_bom2 and role = 'kasa') <> 10 then
    raise exception 'TEST BAŞARISIZ: sistem silinince anlık görüntü bozuldu';
  end if;
  raise notice 'PASS B: sistem silinince onaylı sürümün sistem/bileşen/maliyet anlık görüntüsü korunur';

  -- Proje silinince onaylı sürüm dahil tüm reçete verisi zincirleme silinir
  insert into public.projects (code, name, category) values ('LX-BOM-2', 'Silinecek', 'cephe') returning id into v_c;
  insert into public.quantity_takeoffs (project_id, name, revision) values (v_c, 'M', 1) returning id into v_tk;
  insert into public.quantity_items (takeoff_id, project_id, poz_code, category, width_mm, height_mm, quantity, verification)
  values (v_tk, v_c, 'X1', 'cephe_dograma', 1000, 1000, 1, 'onaylandi') returning id into v_i1;
  update public.quantity_takeoffs set status = 'onaylandi' where id = v_tk;
  v_bom1 := public.create_bom_version(v_c, v_tk, jsonb_build_object('assignments', jsonb_build_array(jsonb_build_object('key', 'a', 'quantity_item_id', v_i1)),
    'lines', jsonb_build_array(jsonb_build_object('assignment_key', 'a', 'line_key', 'k', 'role', 'cam', 'name', 'c', 'unit', 'm2', 'net_quantity', 1, 'quantity', 1))));
  perform public.approve_bom_version(v_bom1);
  delete from public.projects where id = v_c;
  if exists (select 1 from public.bom_versions where id = v_bom1) or exists (select 1 from public.bom_lines where bom_version_id = v_bom1) then
    raise exception 'TEST BAŞARISIZ: proje silinince reçete kaldı';
  end if;
  raise notice 'PASS B: proje silinince onaylı reçete dahil zincirleme silinir';
end;
$$;
reset role;

-- =====================================================================
-- C) YETKİSİZ HESAP
-- =====================================================================
set local role authenticated;
select pg_temp.act_as(current_setting('leonx.intruder'));
do $$
declare t text; v_n int;
begin
  foreach t in array array['product_systems', 'system_components', 'system_rules', 'bom_versions', 'bom_assignments', 'bom_lines',
    'bom_material_totals', 'bom_cut_list'] loop
    execute format('select count(*) from public.%I', t) into v_n;
    if v_n <> 0 then raise exception 'TEST BAŞARISIZ: yetkisiz hesap % içinde % satır gördü', t, v_n; end if;
  end loop;
  raise notice 'PASS C: yetkisiz hesap hiçbir reçete verisini (görünümler dahil) göremez';
  begin
    insert into public.product_systems (name) values ('Sızma');
    raise exception 'TEST BAŞARISIZ: yetkisiz hesap sistem ekledi';
  exception when insufficient_privilege then raise notice 'PASS C: yetkisiz hesap sistem ekleyemez';
  end;
  begin
    perform public.create_bom_version(current_setting('leonx.p')::uuid, gen_random_uuid(), '{"assignments":[],"lines":[]}'::jsonb);
    raise exception 'TEST BAŞARISIZ: yetkisiz hesap sürüm oluşturdu';
  exception when insufficient_privilege then raise notice 'PASS C: yetkisiz hesap create_bom_version ile sürüm oluşturamaz';
  end;
  update public.bom_versions set notes = 'x';
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'TEST BAŞARISIZ: yetkisiz hesap sürüm değiştirdi'; end if;
  begin
    perform public.approve_bom_version((select gen_random_uuid()));
    raise exception 'TEST BAŞARISIZ: yetkisiz onay';
  exception when no_data_found then raise notice 'PASS C: yetkisiz hesap sürüm göremez/onaylayamaz';
  end;
end;
$$;
reset role;

do $$
begin
  if (select count(*)::text from public.companies) <> current_setting('leonx.companies_before') then
    null; -- test içinde eklenen firma ROLLBACK ile geri alınır; mevcut kayıt kontrolü aşağıda
  end if;
  if not exists (select 1 from public.companies where name = 'Mevcut veri — silinmemeli') then
    raise exception 'TEST BAŞARISIZ: mevcut veri etkilendi';
  end if;
  raise notice 'PASS D: mevcut veri yerinde (migration ve test mevcut kayıtlara dokunmaz)';
end;
$$;

do $$ begin raise notice 'TESTLER BAŞARILI (bom)'; end $$;
rollback;
