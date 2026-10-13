-- =====================================================================
-- LEONX OS — Teklif tabloları: RLS, numaralandırma, kilit, revizyon ve silme kuralları
--
-- Tek işlem içinde çalışır ve sonunda ROLLBACK yapar; kalıcı veri bırakmaz.
--   A) anon: teklif tablolarına ve fonksiyonlarına erişemez
--   B) sahip: numara, kalem, durum kilidi, revizyon, kopya, geçmiş, ayarlar
--   C) yetkisiz hesap: hiçbir teklifi göremez/değiştiremez
--   D) silme ilişkileri (proje, firma, metraj pozu, revizyon)
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
  foreach t in array array['quotes', 'quote_items', 'quote_history', 'quote_settings', 'quote_counters'] loop
    begin
      execute format('select count(*) from public.%I', t);
      raise exception 'TEST BAŞARISIZ: anon % tablosunu okuyabildi', t;
    exception when insufficient_privilege then
      raise notice 'PASS TA: anon % okuyamaz', t;
    end;
  end loop;
  begin
    perform public.copy_quote(gen_random_uuid(), 'kopya');
    raise exception 'TEST BAŞARISIZ: anon copy_quote çağırabildi';
  exception when insufficient_privilege then
    raise notice 'PASS TA: anon copy_quote çağıramaz';
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
  v_company uuid; v_project uuid; v_q1 uuid; v_q2 uuid; v_rev uuid; v_copy uuid; v_item uuid;
  v_no1 text; v_no2 text; v_row public.quotes; v_n int; v_year text := extract(year from current_date)::text;
begin
  insert into public.quote_settings (id, quote_prefix, default_vat_pct) values (1, 'LXT', 20)
  on conflict (id) do update set quote_prefix = 'LXT';
  insert into public.companies (name) values ('Teklif Test Firma') returning id into v_company;
  insert into public.projects (code, name, category, company_id) values ('LX-TKL-1', 'Teklif projesi', 'cephe', v_company) returning id into v_project;
  perform set_config('leonx.t_company', v_company::text, true);
  perform set_config('leonx.t_project', v_project::text, true);

  -- Numara: sunucuda atanır, istemci değeri yok sayılır, ardışık ve benzersiz
  insert into public.quotes (company_id, project_id, title, quote_no, root_id, valid_until)
  values (v_company, v_project, 'Cephe teklifi', 'SAHTE-1', gen_random_uuid(), current_date + 15)
  returning id, quote_no into v_q1, v_no1;
  insert into public.quotes (company_id, title, quote_no, root_id) values (v_company, 'İkinci', 'SAHTE-1', gen_random_uuid())
  returning id, quote_no into v_q2, v_no2;
  if v_no1 !~ ('^LXT-' || v_year || '-[0-9]{4}$') then raise exception 'TEST BAŞARISIZ: numara biçimi %', v_no1; end if;
  if v_no1 = v_no2 or split_part(v_no2, '-', 3)::int <> split_part(v_no1, '-', 3)::int + 1 then
    raise exception 'TEST BAŞARISIZ: numaralar ardışık/benzersiz değil (%, %)', v_no1, v_no2;
  end if;
  select * into v_row from public.quotes where id = v_q1;
  if v_row.root_id <> v_q1 or v_row.revision <> 1 or v_row.status <> 'taslak' then raise exception 'TEST BAŞARISIZ: kök teklif alanları'; end if;
  raise notice 'PASS TB: numara sunucuda atanır (%), ardışık ve benzersiz; istemci numarası yok sayılır', v_no1;

  begin
    insert into public.quotes (company_id, title, status) values (v_company, 'Doğrudan gönderilmiş', 'gonderildi');
    raise exception 'TEST BAŞARISIZ: gönderilmiş durumda yeni teklif oluşturuldu';
  exception when check_violation then raise notice 'PASS TB: yeni teklif yalnızca taslak oluşturulur'; end;

  begin
    insert into public.quotes (company_id, title, valid_until, quote_date) values (v_company, 'Geçersiz tarih', current_date - 1, current_date);
    raise exception 'TEST BAŞARISIZ: geçerlilik tarihi teklif tarihinden önce olabildi';
  exception when check_violation then raise notice 'PASS TB: geçerlilik tarihi teklif tarihinden önce olamaz'; end;

  -- Kalemler
  insert into public.quote_items (quote_id, poz_code, description, width_mm, height_mm, quantity, unit, unit_price)
  values (v_q1, 'P1', 'Pencere', 1500, 2000, 4, 'm2', 3500) returning id into v_item;
  insert into public.quote_items (quote_id, poz_code, description, quantity, unit, unit_price) values (v_q1, 'K1', 'Korkuluk', 12.5, 'mtul', 900);
  begin
    insert into public.quote_items (quote_id, description, quantity) values (v_q1, 'Sıfır adet', 0);
    raise exception 'TEST BAŞARISIZ: adet 0 kabul edildi';
  exception when check_violation then raise notice 'PASS TB: adet sıfır/negatif olamaz'; end;
  begin
    insert into public.quote_items (quote_id, description, quantity, unit_price) values (v_q1, 'Negatif fiyat', 1, -5);
    raise exception 'TEST BAŞARISIZ: negatif fiyat kabul edildi';
  exception when check_violation then raise notice 'PASS TB: negatif fiyat reddedilir'; end;
  begin
    update public.quotes set discount_kind = 'yuzde', discount_value = 150 where id = v_q1;
    raise exception 'TEST BAŞARISIZ: %%150 indirim kabul edildi';
  exception when check_violation then raise notice 'PASS TB: yüzde indirim 100''ü aşamaz'; end;
  update public.quotes set vat_pct = 10, discount_kind = 'yuzde', discount_value = 5 where id = v_q1;
  select * into v_row from public.quotes where id = v_q1;
  if v_row.vat_pct <> 10 or v_row.version <> 2 then raise exception 'TEST BAŞARISIZ: taslak güncellenemedi / sürüm artmadı'; end if;
  raise notice 'PASS TB: taslak teklif düzenlenir, KDV oranı değiştirilebilir, sürüm artar';

  -- Gönderildi: içerik ve kalemler kilitlenir
  update public.quotes set status = 'gonderildi' where id = v_q1;
  select * into v_row from public.quotes where id = v_q1;
  if v_row.sent_at is null then raise exception 'TEST BAŞARISIZ: sent_at yazılmadı'; end if;
  begin
    update public.quotes set title = 'Değişti' where id = v_q1;
    raise exception 'TEST BAŞARISIZ: gönderilmiş teklifin başlığı değişti';
  exception when check_violation then raise notice 'PASS TB: gönderilmiş teklifin içeriği kilitli'; end;
  begin
    update public.quote_items set unit_price = 1 where id = v_item;
    raise exception 'TEST BAŞARISIZ: gönderilmiş teklifin kalemi değişti';
  exception when check_violation then raise notice 'PASS TB: gönderilmiş teklifin kalemleri kilitli'; end;
  begin
    insert into public.quote_items (quote_id, description, quantity) values (v_q1, 'Sonradan', 1);
    raise exception 'TEST BAŞARISIZ: gönderilmiş teklife kalem eklendi';
  exception when check_violation then raise notice 'PASS TB: gönderilmiş teklife kalem eklenemez'; end;
  begin
    update public.quotes set status = 'taslak' where id = v_q1;
    raise exception 'TEST BAŞARISIZ: gönderilmiş teklif taslağa döndü';
  exception when check_violation then raise notice 'PASS TB: gönderilmiş teklif taslağa döndürülemez'; end;
  begin
    delete from public.quotes where id = v_q1;
    raise exception 'TEST BAŞARISIZ: gönderilmiş teklif silindi';
  exception when check_violation then raise notice 'PASS TB: gönderilmiş teklif silinemez'; end;
  update public.quotes set status = 'gorusmede', internal_notes = 'Müşteri indirim istedi' where id = v_q1;
  raise notice 'PASS TB: gönderilmiş teklifte durum ve iç not güncellenebilir';

  -- Revizyon
  v_rev := public.copy_quote(v_q1, 'revizyon');
  select * into v_row from public.quotes where id = v_rev;
  if v_row.quote_no <> v_no1 or v_row.revision <> 2 or v_row.root_id <> v_q1 or v_row.status <> 'taslak' or v_row.superseded then
    raise exception 'TEST BAŞARISIZ: revizyon alanları (% rev %)', v_row.quote_no, v_row.revision;
  end if;
  select count(*) into v_n from public.quote_items where quote_id = v_rev;
  if v_n <> 2 then raise exception 'TEST BAŞARISIZ: revizyona % kalem kopyalandı', v_n; end if;
  if not (select superseded from public.quotes where id = v_q1) then raise exception 'TEST BAŞARISIZ: eski revizyon kilitlenmedi'; end if;
  raise notice 'PASS TB: revizyon aynı numarayla Rev 2 oluşturur, kalemleri kopyalar, eskiyi kilitler';
  begin
    update public.quotes set status = 'kabul' where id = v_q1;
    raise exception 'TEST BAŞARISIZ: eski revizyonun durumu değişti';
  exception when check_violation then raise notice 'PASS TB: eski revizyon tamamen kilitli'; end;
  begin
    perform public.copy_quote(v_q1, 'revizyon');
    raise exception 'TEST BAŞARISIZ: eski revizyondan revizyon oluşturuldu';
  exception when check_violation then raise notice 'PASS TB: eski revizyondan yeni revizyon oluşturulamaz'; end;
  begin
    delete from public.quotes where id = v_q1;
    raise exception 'TEST BAŞARISIZ: eski revizyon silindi';
  exception when check_violation then raise notice 'PASS TB: eski revizyon silinemez'; end;
  update public.quote_items set unit_price = 3400 where quote_id = v_rev and poz_code = 'P1';
  raise notice 'PASS TB: yeni revizyon taslağı düzenlenebilir';

  -- Son taslak revizyon silinirse önceki revizyon yeniden güncel olur
  delete from public.quotes where id = v_rev;
  if (select superseded from public.quotes where id = v_q1) then raise exception 'TEST BAŞARISIZ: önceki revizyon güncel olmadı'; end if;
  raise notice 'PASS TB: son taslak revizyon silinince önceki revizyon güncel olur';
  v_rev := public.copy_quote(v_q1, 'revizyon');
  if (select revision from public.quotes where id = v_rev) <> 2 then raise exception 'TEST BAŞARISIZ: revizyon numarası'; end if;
  perform set_config('leonx.t_q1', v_q1::text, true);
  perform set_config('leonx.t_rev', v_rev::text, true);

  -- Kopya
  v_copy := public.copy_quote(v_rev, 'kopya');
  select * into v_row from public.quotes where id = v_copy;
  if v_row.quote_no = v_no1 or v_row.revision <> 1 or v_row.root_id <> v_copy or v_row.title not like '%(kopya)' then
    raise exception 'TEST BAŞARISIZ: kopya alanları';
  end if;
  if (select superseded from public.quotes where id = v_rev) then raise exception 'TEST BAŞARISIZ: kopya kaynağı kilitledi'; end if;
  select count(*) into v_n from public.quote_history where quote_id = v_copy and action = 'kopya' and note like v_no1 || '%';
  if v_n <> 1 then raise exception 'TEST BAŞARISIZ: kopya geçmiş kaydı yok'; end if;
  raise notice 'PASS TB: kopya yeni numarayla bağımsız taslak oluşturur ve geçmişe yazılır';

  -- Geçmiş
  -- olustur + 2 durum (gönderildi, görüşmede) + revizyon (silinen Rev 2'nin kaydı onunla silinir)
  select count(*) into v_n from public.quote_history where root_id = v_q1
     and action in ('olustur', 'durum', 'revizyon');
  if v_n <> 4 or not exists (select 1 from public.quote_history where root_id = v_q1 and action = 'durum' and from_status = 'taslak' and to_status = 'gonderildi') then
    raise exception 'TEST BAŞARISIZ: geçmiş kaydı eksik (%)', v_n;
  end if;
  begin
    insert into public.quote_history (quote_id, root_id, action) values (v_q1, v_q1, 'durum');
    raise exception 'TEST BAŞARISIZ: istemci geçmişe yazabildi';
  exception when insufficient_privilege then raise notice 'PASS TB: geçmiş yalnızca tetikleyiciyle yazılır (% kayıt)', v_n; end;

  -- Sayaç istemciye kapalı
  begin
    perform count(*) from public.quote_counters;
    raise exception 'TEST BAŞARISIZ: sayaç okunabildi';
  exception when insufficient_privilege then raise notice 'PASS TB: numara sayacı istemciye kapalı'; end;
  begin
    insert into public.quote_settings (id, quote_prefix) values (2, 'X');
    raise exception 'TEST BAŞARISIZ: ikinci ayar satırı eklendi';
  exception when check_violation then raise notice 'PASS TB: teklif ayarları tek satırdır'; end;
end;
$$;

-- =====================================================================
-- C) YETKİSİZ HESAP
-- =====================================================================
select pg_temp.act_as(current_setting('leonx.intruder'));
do $$
declare v_n int;
begin
  select count(*) into v_n from public.quotes;
  if v_n <> 0 then raise exception 'TEST BAŞARISIZ: yetkisiz hesap % teklif gördü', v_n; end if;
  select count(*) into v_n from public.quote_items;
  if v_n <> 0 then raise exception 'TEST BAŞARISIZ: yetkisiz hesap kalem gördü'; end if;
  select count(*) into v_n from public.quote_settings;
  if v_n <> 0 then raise exception 'TEST BAŞARISIZ: yetkisiz hesap ayarları gördü'; end if;
  update public.quote_items set unit_price = 1 where quote_id = current_setting('leonx.t_rev')::uuid;
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'TEST BAŞARISIZ: yetkisiz hesap kalem değiştirdi'; end if;
  begin
    insert into public.quotes (company_id, title) values (current_setting('leonx.t_company')::uuid, 'Sızma');
    raise exception 'TEST BAŞARISIZ: yetkisiz hesap teklif ekledi';
  exception when insufficient_privilege then raise notice 'PASS TC: yetkisiz hesap teklif ekleyemez'; end;
  begin
    perform public.copy_quote(current_setting('leonx.t_rev')::uuid, 'kopya');
    raise exception 'TEST BAŞARISIZ: yetkisiz hesap kopyaladı';
  exception when no_data_found then raise notice 'PASS TC: yetkisiz hesap teklifi kopyalayamaz (görünmez)'; end;
  raise notice 'PASS TC: yetkisiz hesap hiçbir teklifi, kalemi veya ayarı göremez/değiştiremez';
end;
$$;

-- =====================================================================
-- D) SİLME İLİŞKİLERİ
-- =====================================================================
select pg_temp.act_as(current_setting('leonx.owner'));
do $$
declare v_n int; v_project uuid := current_setting('leonx.t_project')::uuid; v_tk uuid; v_qi uuid; v_q uuid; v_item uuid;
begin
  -- Metraj pozu silinince gönderilmiş teklif kalemi korunur, kaynak bağlantısı boşalır
  insert into public.quantity_takeoffs (project_id, name, revision) values (v_project, 'M', 1) returning id into v_tk;
  insert into public.quantity_items (takeoff_id, project_id, poz_code, category, width_mm, height_mm, quantity)
  values (v_tk, v_project, 'P9', 'al_pencere', 1000, 1000, 1) returning id into v_qi;
  insert into public.quotes (company_id, project_id, title) values (current_setting('leonx.t_company')::uuid, v_project, 'Metrajlı') returning id into v_q;
  insert into public.quote_items (quote_id, description, quantity, unit, source, source_item_id, source_takeoff_id, measure_verified)
  values (v_q, 'Metrajdan', 1, 'm2', 'metraj', v_qi, v_tk, false) returning id into v_item;
  update public.quotes set status = 'gonderildi' where id = v_q;
  delete from public.quantity_items where id = v_qi;
  if (select source_item_id from public.quote_items where id = v_item) is not null then raise exception 'TEST BAŞARISIZ: kaynak bağlantısı boşalmadı'; end if;
  raise notice 'PASS TD: metraj pozu silinince kilitli teklifin kalemi korunur, kaynak bağlantısı boşalır';

  -- Teklifi olan firma silinemez
  begin
    delete from public.companies where id = current_setting('leonx.t_company')::uuid;
    raise exception 'TEST BAŞARISIZ: teklifi olan firma silindi';
  exception when foreign_key_violation then raise notice 'PASS TD: teklifi olan firma silinemez'; end;

  -- Proje silinince teklifler (kilitli olanlar dahil) korunur, bağlantı boşalır
  delete from public.projects where id = v_project;
  select count(*) into v_n from public.quotes where id in (v_q, current_setting('leonx.t_q1')::uuid) and project_id is null;
  if v_n <> 2 then raise exception 'TEST BAŞARISIZ: proje silinince teklif bağlantısı (%)', v_n; end if;
  raise notice 'PASS TD: proje silinince kilitli teklifler korunur, proje bağlantısı boşalır';

  -- Taslak teklif silinince kalemleri de silinir
  delete from public.quotes where id = current_setting('leonx.t_rev')::uuid;
  select count(*) into v_n from public.quote_items where quote_id = current_setting('leonx.t_rev')::uuid;
  if v_n <> 0 then raise exception 'TEST BAŞARISIZ: taslak teklifin kalemleri kaldı'; end if;
  raise notice 'PASS TD: taslak teklif silinince kalemleri de silinir';
end;
$$;
reset role;

do $$
declare v_n int;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    select count(*) into v_n from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public'
       and tablename in ('quotes', 'quote_items', 'quote_history', 'quote_settings');
    if v_n <> 4 then raise exception 'TEST BAŞARISIZ: Realtime yayınında % / 4 teklif tablosu var', v_n; end if;
    raise notice 'PASS: 4 teklif tablosu Realtime yayınında';
  end if;
  select count(*) into v_n from pg_tables where schemaname = 'public'
     and tablename in ('quotes', 'quote_items', 'quote_history', 'quote_settings', 'quote_counters') and rowsecurity;
  if v_n <> 5 then raise exception 'TEST BAŞARISIZ: RLS % / 5 tabloda açık', v_n; end if;
  raise notice 'PASS: 5 teklif tablosunda RLS açık';
  raise notice 'TÜM TEKLİF TESTLERİ BAŞARILI';
end;
$$;

select 'TÜM TEKLİF TESTLERİ BAŞARILI' as sonuc;
rollback;
