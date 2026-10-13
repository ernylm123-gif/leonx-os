-- =====================================================================
-- LEONX OS — CAD analizi ve metraj tabloları: RLS, bütünlük ve sürüm kuralları
--
-- Tek işlem içinde çalışır ve sonunda ROLLBACK yapar; kalıcı veri bırakmaz.
-- Senaryolar:
--   A) anon: yeni tabloların hiçbirine erişemez
--   B) sahip: sürüm, poz, geçmiş, kısıtlar, onay kilidi, revizyon kopyalama
--   C) yetkisiz hesap: hiçbir kaydı göremez/yazamaz
--   D) silme ilişkileri (dosya, analiz, proje)
-- =====================================================================
begin;

do $$
begin
  if not exists (select 1 from public.app_owner) then
    raise exception 'Önce yetkili kullanıcıyı tanımlayın (supabase/setup/01_set_owner.sql).';
  end if;
end;
$$;

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
  foreach t in array array['cad_analyses', 'quantity_takeoffs', 'quantity_items', 'quantity_item_history'] loop
    begin
      execute format('select count(*) from public.%I', t);
      raise exception 'TEST BAŞARISIZ: anon % tablosunu okuyabildi', t;
    exception when insufficient_privilege then
      raise notice 'PASS QA: anon % okuyamaz', t;
    end;
  end loop;
  begin
    perform public.create_takeoff_revision(gen_random_uuid(), 'x');
    raise exception 'TEST BAŞARISIZ: anon revizyon fonksiyonunu çağırabildi';
  exception when insufficient_privilege then
    raise notice 'PASS QA: anon revizyon fonksiyonunu çağıramaz';
  end;
end;
$$;
reset role;

-- =====================================================================
-- B) SAHİP
-- =====================================================================
set local role authenticated;
select pg_temp.act_as(current_setting('leonx.owner'));

do $$
declare
  v_project  uuid;
  v_project2 uuid;
  v_file     uuid;
  v_analysis uuid;
  v_takeoff  uuid;
  v_item     uuid;
  v_rev      uuid;
  v_n        int;
  v_row      record;
begin
  insert into public.projects (code, name, category) values ('LX-TEST-Q1', 'Metraj testi', 'pvc_dograma') returning id into v_project;
  insert into public.projects (code, name, category) values ('LX-TEST-Q2', 'Başka proje', 'pvc_dograma') returning id into v_project2;
  insert into public.project_files (project_id, storage_path, file_name, mime_type, size_bytes)
    values (v_project, v_project::text || '/test-plan.dxf', 'plan.dxf', 'image/vnd.dxf', 1000) returning id into v_file;
  insert into public.cad_analyses (project_id, file_id, file_name, file_kind, units_mm_per_unit, units_source, units_verified, engine_version, summary)
    values (v_project, v_file, 'plan.dxf', 'dxf', 1, 'dosya', true, 'leonx-dxf-1', '{"entities": 10}') returning id into v_analysis;
  insert into public.quantity_takeoffs (project_id, name, revision, analysis_id) values (v_project, 'İlk metraj', 1, v_analysis) returning id into v_takeoff;
  raise notice 'PASS QB: analiz ve metraj sürümü oluşturuldu';

  -- project_id istemci değeri yok sayılır, sürümün projesi kullanılır
  insert into public.quantity_items (takeoff_id, project_id, poz_code, category, width_mm, height_mm, quantity, unit, verification)
    values (v_takeoff, v_project2, 'P1', 'pvc_pencere', 1200, 1500, 3, 'm2', 'onaylandi') returning id into v_item;
  select * into v_row from public.quantity_items where id = v_item;
  if v_row.project_id <> v_project or v_row.created_by::text <> current_setting('leonx.owner') or v_row.version <> 1 then
    raise exception 'TEST BAŞARISIZ: poz project_id/created_by/version sunucuda belirlenmedi';
  end if;
  raise notice 'PASS QB: poz eklendi; project_id sürümden, created_by ve version sunucudan';

  -- Sürüm kontrollü güncelleme
  update public.quantity_items set quantity = 4 where id = v_item and version = 1;
  update public.quantity_items set quantity = 5 where id = v_item and version = 1; -- eski sürüm: etkisiz
  select quantity, version into v_row from public.quantity_items where id = v_item;
  if v_row.quantity <> 4 or v_row.version <> 2 then raise exception 'TEST BAŞARISIZ: sürüm çakışma kontrolü'; end if;
  raise notice 'PASS QB: eşzamanlılık (version) kontrolü çalışıyor';

  -- Geçmiş
  select count(*) into v_n from public.quantity_item_history where item_id = v_item and action = 'ekle';
  if v_n <> 1 then raise exception 'TEST BAŞARISIZ: ekleme geçmişi yok'; end if;
  select count(*) into v_n from public.quantity_item_history
   where item_id = v_item and action = 'guncelle' and changes -> 'quantity' ->> 'eski' = '3' and changes -> 'quantity' ->> 'yeni' = '4';
  if v_n <> 1 then raise exception 'TEST BAŞARISIZ: alan bazlı düzeltme geçmişi yazılmadı'; end if;
  raise notice 'PASS QB: manuel düzeltme geçmişi alan bazlı kaydedildi';
  begin
    insert into public.quantity_item_history (item_id, takeoff_id, project_id, action) values (v_item, v_takeoff, v_project, 'sil');
    raise exception 'TEST BAŞARISIZ: geçmişe istemci yazabildi';
  exception when insufficient_privilege then
    raise notice 'PASS QB: geçmiş tablosu istemci için salt okunur';
  end;

  -- Kısıtlar
  begin
    insert into public.quantity_items (takeoff_id, project_id, poz_code, category, quantity) values (v_takeoff, v_project, 'X', 'pvc_pencere', 0);
    raise exception 'TEST BAŞARISIZ: adet 0 kabul edildi';
  exception when check_violation then raise notice 'PASS QB: adet 0 reddedildi';
  end;
  begin
    insert into public.quantity_items (takeoff_id, project_id, poz_code, category, width_mm) values (v_takeoff, v_project, 'X', 'pvc_pencere', -10);
    raise exception 'TEST BAŞARISIZ: negatif ölçü kabul edildi';
  exception when check_violation then raise notice 'PASS QB: negatif ölçü reddedildi';
  end;
  begin
    insert into public.quantity_items (takeoff_id, project_id, poz_code, category) values (v_takeoff, v_project, 'X', 'ahsap');
    raise exception 'TEST BAŞARISIZ: geçersiz kategori kabul edildi';
  exception when check_violation then raise notice 'PASS QB: geçersiz kategori reddedildi';
  end;
  begin
    insert into public.quantity_takeoffs (project_id, name, revision) values (v_project, 'Aynı revizyon', 1);
    raise exception 'TEST BAŞARISIZ: aynı revizyon numarası kabul edildi';
  exception when unique_violation then raise notice 'PASS QB: revizyon numarası proje içinde benzersiz';
  end;
  begin
    insert into public.quantity_takeoffs (project_id, name, revision, status) values (v_project, 'Doğrudan onaylı', 9, 'onaylandi');
    raise exception 'TEST BAŞARISIZ: onaylı sürüm doğrudan oluşturuldu';
  exception when check_violation then raise notice 'PASS QB: yeni sürüm yalnızca taslak olarak oluşturulur';
  end;

  -- Onay ve kilit
  update public.quantity_takeoffs set status = 'onaylandi' where id = v_takeoff;
  select approved_at, approved_by into v_row from public.quantity_takeoffs where id = v_takeoff;
  if v_row.approved_at is null or v_row.approved_by::text <> current_setting('leonx.owner') then
    raise exception 'TEST BAŞARISIZ: onay zamanı/onaylayan sunucuda yazılmadı';
  end if;
  raise notice 'PASS QB: onay zamanı ve onaylayan sunucuda kaydedildi';
  begin
    update public.quantity_items set quantity = 9 where id = v_item;
    raise exception 'TEST BAŞARISIZ: onaylı sürümdeki poz değiştirildi';
  exception when check_violation then raise notice 'PASS QB: onaylı sürümdeki poz değiştirilemez';
  end;
  begin
    insert into public.quantity_items (takeoff_id, project_id, poz_code, category) values (v_takeoff, v_project, 'Y', 'pvc_pencere');
    raise exception 'TEST BAŞARISIZ: onaylı sürüme poz eklendi';
  exception when check_violation then raise notice 'PASS QB: onaylı sürüme poz eklenemez';
  end;
  begin
    delete from public.quantity_items where id = v_item;
    raise exception 'TEST BAŞARISIZ: onaylı sürümden poz silindi';
  exception when check_violation then raise notice 'PASS QB: onaylı sürümden poz silinemez';
  end;
  begin
    delete from public.quantity_takeoffs where id = v_takeoff;
    raise exception 'TEST BAŞARISIZ: onaylı sürüm silindi';
  exception when check_violation then raise notice 'PASS QB: onaylı sürüm silinemez';
  end;
  begin
    update public.quantity_takeoffs set name = 'Değişti' where id = v_takeoff;
    raise exception 'TEST BAŞARISIZ: onaylı sürümün adı değişti';
  exception when check_violation then raise notice 'PASS QB: onaylı sürüm bilgisi değiştirilemez';
  end;

  -- Yeni revizyon
  v_rev := public.create_takeoff_revision(v_takeoff, 'Revizyon 2');
  select revision, status, based_on into v_row from public.quantity_takeoffs where id = v_rev;
  if v_row.revision <> 2 or v_row.status <> 'taslak' or v_row.based_on <> v_takeoff then
    raise exception 'TEST BAŞARISIZ: revizyon bilgileri hatalı';
  end if;
  select count(*) into v_n from public.quantity_items where takeoff_id = v_rev and poz_code = 'P1' and quantity = 4;
  if v_n <> 1 then raise exception 'TEST BAŞARISIZ: pozlar yeni sürüme kopyalanmadı'; end if;
  if public.next_takeoff_revision(v_project) <> 3 then raise exception 'TEST BAŞARISIZ: sıradaki revizyon numarası'; end if;
  raise notice 'PASS QB: yeni revizyon taslak olarak oluşturuldu ve pozlar kopyalandı';
  update public.quantity_items set quantity = 6 where takeoff_id = v_rev;
  raise notice 'PASS QB: yeni taslak sürüm düzenlenebilir';

  -- Arşiv
  update public.quantity_takeoffs set status = 'arsiv' where id = v_takeoff;
  begin
    update public.quantity_takeoffs set status = 'taslak' where id = v_takeoff;
    raise exception 'TEST BAŞARISIZ: arşiv sürüm yeniden açıldı';
  exception when check_violation then raise notice 'PASS QB: arşivlenmiş sürüm yeniden açılamaz';
  end;

  -- =================================================================
  -- D) Silme ilişkileri
  -- =================================================================
  delete from public.project_files where id = v_file;
  select file_id into v_row from public.cad_analyses where id = v_analysis;
  if v_row.file_id is not null then raise exception 'TEST BAŞARISIZ: dosya silinince analiz bağlantısı boşaltılmadı'; end if;
  raise notice 'PASS QD: dosya silinince analiz korunur, bağlantı boşaltılır';
  delete from public.cad_analyses where id = v_analysis;
  select count(*) into v_n from public.quantity_takeoffs where project_id = v_project and analysis_id is null;
  if v_n <> 2 then raise exception 'TEST BAŞARISIZ: analiz silinince metraj sürümleri korunmadı'; end if;
  raise notice 'PASS QD: analiz silinince metraj sürümleri korunur';

  perform set_config('leonx.q_project', v_project::text, true);
  perform set_config('leonx.q_project2', v_project2::text, true);
end;
$$;

-- =====================================================================
-- C) YETKİSİZ HESAP
-- =====================================================================
select pg_temp.act_as(current_setting('leonx.intruder'));
do $$
declare
  t text;
  v_n int;
begin
  foreach t in array array['cad_analyses', 'quantity_takeoffs', 'quantity_items', 'quantity_item_history'] loop
    execute format('select count(*) from public.%I', t) into v_n;
    if v_n <> 0 then raise exception 'TEST BAŞARISIZ: yetkisiz hesap % kayıt gördü (%)', v_n, t; end if;
  end loop;
  raise notice 'PASS QC: yetkisiz hesap hiçbir analiz/metraj kaydı göremez';
  begin
    insert into public.quantity_takeoffs (project_id, name, revision) values (current_setting('leonx.q_project')::uuid, 'Sızma', 50);
    raise exception 'TEST BAŞARISIZ: yetkisiz hesap sürüm ekledi';
  exception when insufficient_privilege then raise notice 'PASS QC: yetkisiz hesap sürüm ekleyemez';
  end;
  update public.quantity_items set quantity = 99;
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'TEST BAŞARISIZ: yetkisiz hesap poz güncelledi'; end if;
  delete from public.quantity_takeoffs;
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'TEST BAŞARISIZ: yetkisiz hesap sürüm sildi'; end if;
  raise notice 'PASS QC: yetkisiz hesap güncelleyemez/silemez';
end;
$$;

-- =====================================================================
-- D) Proje silinince zincirleme silme (onaylı sürüm dahil)
-- =====================================================================
select pg_temp.act_as(current_setting('leonx.owner'));
do $$
declare v_n int;
begin
  -- Onaylı (şu an arşiv) sürümü ve taslak sürümü olan proje silinebilmeli
  delete from public.projects where id = current_setting('leonx.q_project')::uuid;
  select (select count(*) from public.quantity_takeoffs where project_id = current_setting('leonx.q_project')::uuid)
       + (select count(*) from public.quantity_items where project_id = current_setting('leonx.q_project')::uuid)
       + (select count(*) from public.quantity_item_history where project_id = current_setting('leonx.q_project')::uuid)
       + (select count(*) from public.cad_analyses where project_id = current_setting('leonx.q_project')::uuid)
    into v_n;
  if v_n <> 0 then raise exception 'TEST BAŞARISIZ: proje silinince metraj kayıtları kaldı (%)', v_n; end if;
  raise notice 'PASS QD: proje silinince analiz, sürüm, poz ve geçmiş zincirleme silinir';
end;
$$;

do $$
declare v_n int;
begin
  -- Onaylı sürümü olan proje: zincirleme silme engellenmemeli
  insert into public.quantity_takeoffs (project_id, name, revision) values (current_setting('leonx.q_project2')::uuid, 'Onaylanacak', 1);
  update public.quantity_takeoffs set status = 'onaylandi' where project_id = current_setting('leonx.q_project2')::uuid;
  delete from public.projects where id = current_setting('leonx.q_project2')::uuid;
  select count(*) into v_n from public.quantity_takeoffs where project_id = current_setting('leonx.q_project2')::uuid;
  if v_n <> 0 then raise exception 'TEST BAŞARISIZ: onaylı sürümlü proje silinemedi'; end if;
  raise notice 'PASS QD: onaylı sürümü olan proje silindiğinde sürüm de silinir';
end;
$$;
reset role;

do $$
declare v_n int;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    select count(*) into v_n from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public'
       and tablename in ('cad_analyses', 'quantity_takeoffs', 'quantity_items');
    if v_n <> 3 then raise exception 'TEST BAŞARISIZ: Realtime yayınında % / 3 metraj tablosu var', v_n; end if;
    raise notice 'PASS: 3 metraj tablosu Realtime yayınında';
  end if;
  select count(*) into v_n from pg_tables where schemaname = 'public'
     and tablename in ('cad_analyses', 'quantity_takeoffs', 'quantity_items', 'quantity_item_history') and rowsecurity;
  if v_n <> 4 then raise exception 'TEST BAŞARISIZ: RLS % / 4 tabloda açık', v_n; end if;
  raise notice 'PASS: 4 yeni tabloda RLS açık';
  raise notice 'TÜM METRAJ TESTLERİ BAŞARILI';
end;
$$;

select 'TÜM METRAJ TESTLERİ BAŞARILI' as sonuc;
rollback;
