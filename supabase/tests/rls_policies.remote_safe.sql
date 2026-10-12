-- =====================================================================
-- LEONX OS — RLS testleri: SİLME İÇERMEYEN ALT KÜME (uzaktan çalıştırma için)
--
-- Kaynak: rls_policies.test.sql. Supabase MCP bağlayıcısı silme (DELETE)
-- içeren sorgular için onay ister; bu dosya o kontrolleri (yetkisiz silme
-- denemesi, yabancı anahtar kısıtı, zincirleme silme, sahip kaydının
-- kaldırılması) içermez. Tam test için rls_policies.test.sql dosyasını
-- Supabase SQL Editor'da çalıştırın.
--
-- Geri alma garantisi: dosya sonunda bilinçli bir hata (LEONX_TEST_SONUC)
-- fırlatılır; PostgreSQL bu çalıştırmadaki tüm değişiklikleri geri alır.
-- Sonuçlar bu hata iletisinde listelenir. Başarısız bir kontrol ise
-- "TEST BAŞARISIZ: ..." iletisiyle durur.
-- =====================================================================
create temp table _leonx_test_sonuc (t timestamptz default clock_timestamp(), msg text);
grant insert, select on _leonx_test_sonuc to anon, authenticated;

-- Test kimlikleri
--   Sahip: app_owner tablosunda TANIMLI olan gerçek hesap (önce 01_set_owner.sql çalıştırılmalı).
--   Yabancı: auth.users'ta bulunmayan rastgele bir UUID; "geçerli oturum, yetkili değil" durumunu taklit eder.
-- auth.users tablosuna hiçbir şey yazılmaz.
do $$
begin
  if not exists (select 1 from public.app_owner) then
    raise exception 'Önce yetkili kullanıcıyı tanımlayın (supabase/setup/01_set_owner.sql), sonra bu testi çalıştırın.';
  end if;
end;
$$;

select set_config('leonx.owner',    (select user_id::text from public.app_owner), true);
select set_config('leonx.intruder', gen_random_uuid()::text, true);

-- Yardımcı: belirli kullanıcı olarak JWT talepleri
create or replace function pg_temp.act_as(p_user text)
returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- =====================================================================
-- A) ANON
-- =====================================================================
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$
declare t text;
begin
  foreach t in array array['companies','contacts','projects','project_notes','project_files',
                           'project_status_history','activity_log','app_owner'] loop
    begin
      execute format('select count(*) from public.%I', t);
      raise exception 'TEST BAŞARISIZ: anon % tablosunu okuyabildi', t;
    exception when insufficient_privilege then
      insert into pg_temp._leonx_test_sonuc (msg) values (format('PASS A: anon %s okuyamaz', t));
    end;
  end loop;

  begin
    insert into public.companies (name) values ('anon firma');
    raise exception 'TEST BAŞARISIZ: anon firma ekleyebildi';
  exception when insufficient_privilege then
    insert into pg_temp._leonx_test_sonuc (msg) values (format('PASS A: anon firma ekleyemez'));
  end;

  begin
    perform public.is_owner();
    raise exception 'TEST BAŞARISIZ: anon is_owner() çağırabildi';
  exception when insufficient_privilege then
    insert into pg_temp._leonx_test_sonuc (msg) values (format('PASS A: anon is_owner() çağıramaz'));
  end;

  if exists (select 1 from storage.objects where bucket_id = 'project-files') then
    raise exception 'TEST BAŞARISIZ: anon depolama nesnelerini görebildi';
  end if;
  insert into pg_temp._leonx_test_sonuc (msg) values (format('PASS A: anon depolama nesnelerini göremez'));
exception when insufficient_privilege then
  insert into pg_temp._leonx_test_sonuc (msg) values (format('PASS A: anon depolama tablosuna erişemez'));
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
  v_owner    uuid := current_setting('leonx.owner')::uuid;
  v_intruder uuid := current_setting('leonx.intruder')::uuid;
  v_company  uuid;
  v_project  uuid;
  v_row      record;
  v_n        int;
begin
  if not public.is_owner() then
    raise exception 'TEST BAŞARISIZ: sahip is_owner() = false';
  end if;
  insert into pg_temp._leonx_test_sonuc (msg) values (format('PASS B: is_owner() = true'));

  -- created_by istemciden sahte gönderilse bile sunucu belirler
  insert into public.companies (name, email, created_by, version)
  values ('LEONX Test Firma', 'info@example.invalid', v_intruder, 99)
  returning id into v_company;
  select * into v_row from public.companies where id = v_company;
  if v_row.created_by <> v_owner or v_row.version <> 1 then
    raise exception 'TEST BAŞARISIZ: created_by/version istemciden değiştirilebildi (%/%)', v_row.created_by, v_row.version;
  end if;
  insert into pg_temp._leonx_test_sonuc (msg) values (format('PASS B: firma eklendi, created_by ve version sunucu tarafından belirlendi'));
  perform set_config('leonx.company', v_company::text, true);

  insert into public.contacts (company_id, full_name, is_primary) values (v_company, 'Test Kişi', true);
  insert into pg_temp._leonx_test_sonuc (msg) values (format('PASS B: ilgili kişi eklendi'));

  insert into public.projects (code, name, company_id, category, status, start_date, due_date)
  values ('LX-TEST-001', 'Test Projesi', v_company, 'aluminyum_dograma', 'kesif', current_date, current_date + 30)
  returning id into v_project;
  perform set_config('leonx.project', v_project::text, true);
  insert into pg_temp._leonx_test_sonuc (msg) values (format('PASS B: proje eklendi'));

  -- İyimser eşzamanlılık: doğru sürümle güncelleme başarılı, eski sürümle 0 satır
  update public.projects set name = 'Test Projesi (güncel)' where id = v_project and version = 1;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'TEST BAŞARISIZ: doğru sürümle güncelleme yapılamadı'; end if;
  update public.projects set name = 'Eski sürüm' where id = v_project and version = 1;
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'TEST BAŞARISIZ: eski sürümle güncelleme kabul edildi'; end if;
  select version into v_n from public.projects where id = v_project;
  if v_n <> 2 then raise exception 'TEST BAŞARISIZ: version artmadı (%)', v_n; end if;
  insert into pg_temp._leonx_test_sonuc (msg) values (format('PASS B: sürüm çakışma kontrolü çalışıyor (version=2)'));

  -- Durum değişimi geçmişe yazılır
  update public.projects set status = 'olcu' where id = v_project;
  select count(*) into v_n from public.project_status_history where project_id = v_project;
  if v_n <> 2 then raise exception 'TEST BAŞARISIZ: durum geçmişi % satır (beklenen 2)', v_n; end if;
  insert into pg_temp._leonx_test_sonuc (msg) values (format('PASS B: durum geçmişi otomatik kaydedildi'));

  select count(*) into v_n from public.activity_log where entity_id = v_project and action = 'status_change';
  if v_n <> 1 then raise exception 'TEST BAŞARISIZ: etkinlik günlüğünde durum değişimi yok'; end if;
  insert into pg_temp._leonx_test_sonuc (msg) values (format('PASS B: etkinlik günlüğü yazıldı'));

  insert into public.project_notes (project_id, body) values (v_project, 'Test notu');
  insert into public.project_files (project_id, storage_path, file_name, mime_type, size_bytes)
  values (v_project, v_project::text || '/plan.pdf', 'plan.pdf', 'application/pdf', 1024);
  insert into pg_temp._leonx_test_sonuc (msg) values (format('PASS B: not ve dosya kaydı eklendi'));

  -- Sahip bile geçmiş ve günlüğe doğrudan yazamaz
  begin
    insert into public.project_status_history (project_id, to_status) values (v_project, 'iptal');
    raise exception 'TEST BAŞARISIZ: geçmiş tablosuna doğrudan yazıldı';
  exception when insufficient_privilege then
    insert into pg_temp._leonx_test_sonuc (msg) values (format('PASS B: geçmiş tablosu salt okunur'));
  end;
  begin
    insert into public.activity_log (entity_type, entity_id, action) values ('project', v_project, 'insert');
    raise exception 'TEST BAŞARISIZ: günlüğe doğrudan yazıldı';
  exception when insufficient_privilege then
    insert into pg_temp._leonx_test_sonuc (msg) values (format('PASS B: etkinlik günlüğü salt okunur'));
  end;

  -- Sahip, sahip yapılandırmasını API üzerinden değiştiremez
  begin
    update public.app_owner set user_id = v_intruder;
    raise exception 'TEST BAŞARISIZ: app_owner istemciden değiştirildi';
  exception when insufficient_privilege then
    insert into pg_temp._leonx_test_sonuc (msg) values (format('PASS B: app_owner istemciden değiştirilemez'));
  end;

  -- Depolama: proje klasörüne yükleme serbest, olmayan proje klasörüne yasak
  insert into storage.objects (bucket_id, name) values ('project-files', v_project::text || '/plan.pdf');
  insert into pg_temp._leonx_test_sonuc (msg) values (format('PASS B: proje klasörüne dosya nesnesi eklendi'));
  begin
    insert into storage.objects (bucket_id, name) values ('project-files', gen_random_uuid()::text || '/x.pdf');
    raise exception 'TEST BAŞARISIZ: var olmayan proje klasörüne yükleme kabul edildi';
  exception when insufficient_privilege then
    insert into pg_temp._leonx_test_sonuc (msg) values (format('PASS B: var olmayan proje klasörüne yükleme engellendi'));
  end;
end;
$$;

reset role;

-- =====================================================================
-- C) YETKİSİZ (geçerli hesap, sahip değil)
-- =====================================================================
set local role authenticated;
select pg_temp.act_as(current_setting('leonx.intruder'));

do $$
declare
  v_company uuid := current_setting('leonx.company')::uuid;
  v_project uuid := current_setting('leonx.project')::uuid;
  v_n int;
  t text;
begin
  if public.is_owner() then raise exception 'TEST BAŞARISIZ: yetkisiz kullanıcı için is_owner() = true'; end if;
  insert into pg_temp._leonx_test_sonuc (msg) values (format('PASS C: is_owner() = false'));

  foreach t in array array['app_owner','companies','contacts','projects','project_notes','project_files',
                           'project_status_history','activity_log'] loop
    execute format('select count(*) from public.%I', t) into v_n;
    if v_n <> 0 then raise exception 'TEST BAŞARISIZ: yetkisiz kullanıcı % tablosunda % satır gördü', t, v_n; end if;
  end loop;
  insert into pg_temp._leonx_test_sonuc (msg) values (format('PASS C: hiçbir tabloda satır göremez'));

  begin
    insert into public.companies (name) values ('Sızma denemesi');
    raise exception 'TEST BAŞARISIZ: yetkisiz kullanıcı firma ekledi';
  exception when insufficient_privilege then
    insert into pg_temp._leonx_test_sonuc (msg) values (format('PASS C: firma ekleyemez'));
  end;

  begin
    insert into public.projects (code, name, category) values ('HACK-1', 'Sızma', 'diger');
    raise exception 'TEST BAŞARISIZ: yetkisiz kullanıcı proje ekledi';
  exception when insufficient_privilege then
    insert into pg_temp._leonx_test_sonuc (msg) values (format('PASS C: proje ekleyemez'));
  end;

  update public.companies set name = 'Değiştirildi' where id = v_company;
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'TEST BAŞARISIZ: yetkisiz kullanıcı firmayı güncelledi'; end if;
  insert into pg_temp._leonx_test_sonuc (msg) values (format('PASS C: başkasının kaydını güncelleyemez (silme denemesi SQL Editor testinde)'));

  if exists (select 1 from storage.objects where bucket_id = 'project-files') then
    raise exception 'TEST BAŞARISIZ: yetkisiz kullanıcı depolama nesnelerini gördü';
  end if;
  begin
    insert into storage.objects (bucket_id, name) values ('project-files', v_project::text || '/sizma.pdf');
    raise exception 'TEST BAŞARISIZ: yetkisiz kullanıcı dosya yükledi';
  exception when insufficient_privilege then
    insert into pg_temp._leonx_test_sonuc (msg) values (format('PASS C: dosya göremez ve yükleyemez'));
  end;

  begin
    insert into public.app_owner (singleton, user_id) values (true, auth.uid())
    on conflict (singleton) do update set user_id = excluded.user_id;
    raise exception 'TEST BAŞARISIZ: yetkisiz kullanıcı kendini sahip yaptı';
  exception when insufficient_privilege then
    insert into pg_temp._leonx_test_sonuc (msg) values (format('PASS C: kendini sahip yapamaz'));
  end;
end;
$$;

reset role;

-- =====================================================================
-- D) VERİ BÜTÜNLÜĞÜ (sahip olarak)
-- =====================================================================
set local role authenticated;
select pg_temp.act_as(current_setting('leonx.owner'));

do $$
declare
  v_company uuid := current_setting('leonx.company')::uuid;
  v_project uuid := current_setting('leonx.project')::uuid;
  v_n int;
begin
  -- Yetkisiz kullanıcının denemelerinden sonra veri bozulmamış olmalı
  select count(*) into v_n from public.companies where id = v_company and name = 'LEONX Test Firma';
  if v_n <> 1 then raise exception 'TEST BAŞARISIZ: firma verisi değişmiş'; end if;
  insert into pg_temp._leonx_test_sonuc (msg) values (format('PASS D: yetkisiz denemelerden sonra veri sağlam'));

  begin
    insert into public.projects (code, name, category) values ('LX-TEST-001', 'Kopya', 'diger');
    raise exception 'TEST BAŞARISIZ: tekrar eden proje kodu kabul edildi';
  exception when unique_violation then
    insert into pg_temp._leonx_test_sonuc (msg) values (format('PASS D: proje kodu benzersiz'));
  end;

  begin
    insert into public.projects (code, name, category) values ('LX-TEST-002', 'Kategori', 'gecersiz');
    raise exception 'TEST BAŞARISIZ: geçersiz kategori kabul edildi';
  exception when check_violation then
    insert into pg_temp._leonx_test_sonuc (msg) values (format('PASS D: geçersiz kategori reddedildi'));
  end;

  begin
    insert into public.projects (code, name, category, start_date, due_date)
    values ('LX-TEST-003', 'Tarih', 'diger', current_date, current_date - 1);
    raise exception 'TEST BAŞARISIZ: teslim tarihi başlangıçtan önce olabildi';
  exception when check_violation then
    insert into pg_temp._leonx_test_sonuc (msg) values (format('PASS D: tarih sırası denetleniyor'));
  end;

  begin
    insert into public.projects (code, name, category) values ('x', 'Kod', 'diger');
    raise exception 'TEST BAŞARISIZ: geçersiz proje kodu kabul edildi';
  exception when check_violation then
    insert into pg_temp._leonx_test_sonuc (msg) values (format('PASS D: proje kodu biçimi denetleniyor'));
  end;

  begin
    insert into public.companies (name, tax_number) values ('Vergi', '12AB');
    raise exception 'TEST BAŞARISIZ: geçersiz vergi numarası kabul edildi';
  exception when check_violation then
    insert into pg_temp._leonx_test_sonuc (msg) values (format('PASS D: vergi numarası biçimi denetleniyor'));
  end;

  begin
    insert into public.project_files (project_id, storage_path, file_name, size_bytes)
    values (v_project, gen_random_uuid()::text || '/x.pdf', 'x.pdf', 10);
    raise exception 'TEST BAŞARISIZ: başka klasördeki dosya yolu kabul edildi';
  exception when check_violation then
    insert into pg_temp._leonx_test_sonuc (msg) values (format('PASS D: dosya yolu proje klasörüyle sınırlı'));
  end;

  begin
    insert into public.project_files (project_id, storage_path, file_name, size_bytes)
    values (v_project, v_project::text || '/buyuk.zip', 'buyuk.zip', 52428801);
    raise exception 'TEST BAŞARISIZ: 50 MB üstü dosya kaydı kabul edildi';
  exception when check_violation then
    insert into pg_temp._leonx_test_sonuc (msg) values (format('PASS D: dosya boyutu sınırı denetleniyor'));
  end;

  if public.suggest_project_code() !~ ('^LX-' || to_char(now(), 'YYYY') || '-[0-9]{3,}$') then
    raise exception 'TEST BAŞARISIZ: proje kodu önerisi biçimi hatalı: %', public.suggest_project_code();
  end if;
  insert into pg_temp._leonx_test_sonuc (msg) values (format('PASS D: proje kodu önerisi %s', public.suggest_project_code()));

end;
$$;

reset role;

-- Realtime yayını (Supabase'de mevcutsa)
do $$
declare v_n int;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    select count(*) into v_n from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename in ('companies','contacts','projects','project_status_history','project_notes','project_files');
    if v_n <> 6 then raise exception 'TEST BAŞARISIZ: Realtime yayınında % / 6 tablo var', v_n; end if;
    insert into pg_temp._leonx_test_sonuc (msg) values (format('PASS: 6 tablo Realtime yayınında'));
  end if;
  if exists (select 1 from storage.buckets where id = 'project-files' and public) then
    raise exception 'TEST BAŞARISIZ: project-files bucket herkese açık';
  end if;
  insert into pg_temp._leonx_test_sonuc (msg) values (format('PASS: project-files bucket özel'));
  insert into pg_temp._leonx_test_sonuc (msg) values (format('TÜM TESTLER BAŞARILI'));
end;
$$;

-- Sonuç: bilinçli hata → bu çalıştırmadaki TÜM değişiklikler otomatik geri alınır
do $$
begin
  raise exception 'LEONX_TEST_SONUC (tüm değişiklikler geri alındı) | % kontrol | %',
    (select count(*) from pg_temp._leonx_test_sonuc where msg like 'PASS%'),
    (select string_agg(msg, ' | ' order by t) from pg_temp._leonx_test_sonuc);
end;
$$;
