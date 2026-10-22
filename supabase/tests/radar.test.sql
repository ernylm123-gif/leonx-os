-- =====================================================================
-- LEONX OS — 015: LEONX AI Radar veritabanı testleri
-- Tek işlem içinde çalışır ve sonunda ROLLBACK yapar; kalıcı veri bırakmaz.
-- Tüm fırsat/öğe verileri SENTETİKTİR (alan adları .test).
-- =====================================================================
begin;

select set_config('leonx.owner', (select user_id::text from public.app_owner), true);
select set_config('leonx.intruder', gen_random_uuid()::text, true);

create or replace function pg_temp.act_as(p_user text)
returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- Sentetik ingest öğesi
create or replace function pg_temp.item(p_url text, p_title text, p_cluster text, p_score int, p_verified boolean, p_city text, p_district text,
  p_deadline date, p_cats jsonb, p_companies jsonb default '[]'::jsonb, p_body text default 'sentetik metin', p_stage text default 'ihale')
returns jsonb language sql as $$
  select jsonb_build_object(
    'url', p_url, 'canonical_url', p_url, 'url_hash', encode(sha256(convert_to(p_url, 'UTF8')), 'hex'),
    'content_hash', encode(sha256(convert_to(p_title || p_body, 'UTF8')), 'hex'),
    'title', p_title, 'summary', p_body, 'published_at', now() - interval '1 day',
    'classification', jsonb_build_object('version', 1), 'analyzer', 'kural-v1',
    'cluster_key', p_cluster, 'cluster_tokens', jsonb_build_array('sentetik', 'hastane'),
    'city', p_city, 'district', p_district, 'is_ankara', p_city = 'Ankara', 'sector', 'kamu', 'project_type', 'hastane', 'stage', p_stage,
    'tender', jsonb_build_object('ikn', '2026/123456', 'deadline', p_deadline), 'deadline', p_deadline,
    'score', p_score, 'score_breakdown', '[]'::jsonb, 'reliability_base', 60, 'reliability_breakdown', '[]'::jsonb,
    'verified_need', p_verified, 'label', case when p_verified then 'dogrulanmis_firsat' else 'potansiyel_ihtiyac' end,
    'risks', '[]'::jsonb, 'categories', p_cats, 'companies', p_companies,
    'evidence', jsonb_build_array(jsonb_build_object('field', 'kaynak', 'claim', 'Kaynak öğesi: ' || p_title, 'excerpt', p_body)));
$$;

-- =====================================================================
-- A) ANON VE YETKİLER
-- =====================================================================
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
declare t text;
begin
  foreach t in array array['radar_settings', 'radar_categories', 'radar_sources', 'radar_source_runs', 'radar_items', 'radar_opportunities',
    'radar_opportunity_categories', 'radar_evidence', 'radar_companies', 'radar_opportunity_companies', 'radar_contacts', 'radar_actions',
    'radar_outreach_drafts', 'radar_search_usage'] loop
    begin
      execute format('select count(*) from public.%I', t);
      raise exception 'TEST BAŞARISIZ: anon % okuyabildi', t;
    exception when insufficient_privilege then null;
    end;
  end loop;
  raise notice 'PASS A: anon hiçbir radar tablosunu okuyamaz (14 tablo)';
  begin
    perform public.radar_ingest(gen_random_uuid(), '{}'::jsonb, '[]'::jsonb);
    raise exception 'TEST BAŞARISIZ: anon radar_ingest çağırdı';
  exception when insufficient_privilege then raise notice 'PASS A: anon radar_ingest çağıramaz';
  end;
  begin
    perform public.radar_add_manual_item('https://x.test/a', 'x', 'y');
    raise exception 'TEST BAŞARISIZ: anon elle öğe ekledi';
  exception when insufficient_privilege then raise notice 'PASS A: anon elle öğe ekleyemez';
  end;
end;
$$;
reset role;

do $$
declare f text;
begin
  foreach f in array array['public.radar_ingest(uuid, jsonb, jsonb)', 'public.radar_service_config()', 'public.radar_service_claim_sources(integer)',
    'public.radar_service_reserve_search()', 'public.radar_notify_pending()', 'public.tg_radar_status()'] loop
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') then
      raise exception 'TEST BAŞARISIZ: % istemciye açık', f;
    end if;
  end loop;
  foreach f in array array['public.radar_ingest(uuid, jsonb, jsonb)', 'public.radar_service_config()', 'public.radar_service_claim_sources(integer)', 'public.radar_service_reserve_search()'] loop
    if not has_function_privilege('service_role', f, 'execute') then raise exception 'TEST BAŞARISIZ: % service_role için kapalı', f; end if;
  end loop;
  raise notice 'PASS A: radar_ingest ve sunucu RPCleri yalnız service_role; tetikleyici/bildirim işlevleri istemciye kapalı';
  if has_table_privilege('authenticated', 'leonx_private.radar_config', 'select') then raise exception 'TEST BAŞARISIZ: radar_config istemciye açık'; end if;
  raise notice 'PASS A: tarama yapılandırması istemciye kapalı';
  if (select count(*) from pg_tables where schemaname = 'public' and tablename like 'radar\_%' and not rowsecurity) > 0 then
    raise exception 'TEST BAŞARISIZ: RLS kapalı radar tablosu var';
  end if;
  raise notice 'PASS A: tüm radar tablolarında RLS açık';
  if (select count(*) from public.radar_opportunities) <> 0 or (select count(*) from public.radar_items) <> 0 then
    raise exception 'TEST BAŞARISIZ: migration sahte fırsat/öğe tohumladı';
  end if;
  if (select count(*) from public.radar_categories) <> 32 or (select count(*) from public.radar_settings) <> 1 then
    raise exception 'TEST BAŞARISIZ: kategori/ayar tohumu hatalı';
  end if;
  raise notice 'PASS A: yalnız ayar ve 32 kategori tohumlandı (sahte fırsat yok; migration iki kez uygulandı)';
end;
$$;

-- =====================================================================
-- B) SAHİP: kaynaklar ve izin kuralları
-- =====================================================================
set local role authenticated;
select pg_temp.act_as(current_setting('leonx.owner'));
do $$
declare v_s uuid; v_s2 uuid; v_m uuid;
begin
  insert into public.radar_sources (name, kind, url, sector_hint, permission_status, active, interval_minutes)
  values ('Sentetik kamu akışı', 'rss', 'https://akis.ornek.test/rss', 'kamu', 'izinli', true, 60) returning id into v_s;
  insert into public.radar_sources (name, kind, url, permission_status, active)
  values ('Sentetik ikinci akış', 'rss', 'https://baska.ornek.test/rss', 'izinli', true) returning id into v_s2;
  insert into public.radar_sources (name, kind, url, permission_status, active)
  values ('İnceleniyor akış', 'rss', 'https://inceleme.ornek.test/rss', 'inceleniyor', true) returning id into v_m;
  perform set_config('leonx.s1', v_s::text, true);
  perform set_config('leonx.s2', v_s2::text, true);
  perform set_config('leonx.s3', v_m::text, true);
  begin
    insert into public.radar_sources (name, kind, url, permission_status) values ('EKAP', 'rss', 'https://ekap.kik.gov.tr/x', 'inceleniyor');
    raise exception 'TEST BAŞARISIZ: EKAP otomatik kaynak olarak eklendi';
  exception when check_violation then raise notice 'PASS B: EKAP otomatik (rss) kaynak olarak eklenemez';
  end;
  begin
    insert into public.radar_sources (name, kind, url, permission_status) values ('ilan.gov.tr', 'manual', 'https://www.ilan.gov.tr/ilan/1', 'izinli');
    raise exception 'TEST BAŞARISIZ: ilan.gov.tr izinli yapıldı';
  exception when check_violation then raise notice 'PASS B: ilan.gov.tr yalnız elle ve izinli olmayan kaynak olabilir';
  end;
  insert into public.radar_sources (name, kind, url, permission_status) values ('ilan.gov.tr elle', 'manual', 'https://www.ilan.gov.tr/ilan/1', 'inceleniyor');
  begin
    insert into public.radar_sources (name, kind, url, interval_minutes) values ('Çok sık', 'rss', 'https://a.ornek.test/rss', 5);
    raise exception 'TEST BAŞARISIZ: 30 dk altı aralık kabul edildi';
  exception when check_violation then raise notice 'PASS B: tarama aralığı en az 30 dakika';
  end;
  begin
    insert into public.radar_sources (name, kind, url) values ('http', 'rss', 'http://a.ornek.test/rss');
    raise exception 'TEST BAŞARISIZ: http kaynak kabul edildi';
  exception when check_violation then raise notice 'PASS B: kaynak adresi yalnız https';
  end;
  begin
    perform public.radar_ingest(v_s, '{}'::jsonb, '[]'::jsonb);
    raise exception 'TEST BAŞARISIZ: sahip radar_ingest çağırdı';
  exception when insufficient_privilege then raise notice 'PASS B: sahip bile radar_ingest çağıramaz (yalnız sunucu)';
  end;
end;
$$;
reset role;

-- =====================================================================
-- C) SUNUCU (service_role): ingest, tekilleştirme, kümeleme, bildirim, bütçe
-- =====================================================================
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
declare
  v_s1 uuid := current_setting('leonx.s1')::uuid;
  v_s2 uuid := current_setting('leonx.s2')::uuid;
  v_r jsonb; v_opp public.radar_opportunities; v_n int; v_seen timestamptz; v_src public.radar_sources;
  v_cats jsonb := '[{"key":"yangin_kapisi","need_status":"dogrulanmis","matched_terms":["yangin kapisi"]},{"key":"teknik_kapi","need_status":"potansiyel","matched_terms":["proje türü"]}]';
  v_cos jsonb := '[{"name":"Sentetik Yapı A.Ş.","normalized_name":"sentetik yapi a s","role":"ana_yuklenici"}]';
  v_claimed int;
begin
  -- Yeni öğe → yeni fırsat, kanıt, kategori, firma, öncelikli bildirim
  v_r := public.radar_ingest(v_s1, jsonb_build_object('id', '00000000-0000-4000-8000-0000000000a1', 'status', 'ok', 'etag', '"e1"'),
    jsonb_build_array(pg_temp.item('https://akis.ornek.test/ilan/1', 'Sentetik hastane yangın kapısı alımı', 'ankara:sentetik1', 85, true, 'Ankara', 'Etimesgut', current_date + 10, v_cats, v_cos)));
  if (v_r ->> 'items_new')::int <> 1 then raise exception 'TEST BAŞARISIZ: yeni öğe sayılmadı %', v_r; end if;
  select * into v_opp from public.radar_opportunities where cluster_key = 'ankara:sentetik1';
  if v_opp.id is null or not v_opp.verified_need or v_opp.label <> 'dogrulanmis_firsat' or v_opp.district <> 'Etimesgut' then raise exception 'TEST BAŞARISIZ: fırsat alanları'; end if;
  perform set_config('leonx.opp1', v_opp.id::text, true);
  if (select count(*) from public.radar_evidence where opportunity_id = v_opp.id) <> 1
     or (select count(*) from public.radar_opportunity_categories where opportunity_id = v_opp.id) <> 2
     or (select need_status from public.radar_opportunity_categories where opportunity_id = v_opp.id and category_key = 'yangin_kapisi') <> 'dogrulanmis'
     or (select role from public.radar_opportunity_companies oc where oc.opportunity_id = v_opp.id) <> 'ana_yuklenici'
     or (select verified from public.radar_opportunity_companies oc where oc.opportunity_id = v_opp.id) then
    raise exception 'TEST BAŞARISIZ: kanıt/kategori/firma yazımı';
  end if;
  raise notice 'PASS C: yeni öğe → fırsat + kanıt + kategoriler + firma (rol doğrulanmamış)';
  if (select count(*) from public.notifications where dedupe_key = 'radar:' || v_opp.id and category = 'firsat' and kind = 'radar_oncelikli' and title like 'Öncelikli Teklif Fırsatı:%') <> 1 then
    raise exception 'TEST BAŞARISIZ: öncelikli bildirim yok';
  end if;
  raise notice 'PASS C: doğrulanmış + son tarih ≤14 gün → "Öncelikli Teklif Fırsatı" bildirimi (firsat kategorisi)';
  select * into v_src from public.radar_sources where id = v_s1;
  if v_src.etag <> '"e1"' or v_src.last_status <> 'ok' or v_src.consecutive_failures <> 0 or v_src.next_run_at < now() + interval '59 minutes' then raise exception 'TEST BAŞARISIZ: kaynak durumu'; end if;
  raise notice 'PASS C: kaynak durumu, ETag ve sonraki çalışma zamanı güncellendi';

  -- Aynı öğe tekrar → yeni öğe yok, yalnız last_seen; tekrar bildirim yok
  update public.radar_items set last_seen_at = now() - interval '1 hour' where canonical_url = 'https://akis.ornek.test/ilan/1';
  select last_seen_at into v_seen from public.radar_items where canonical_url = 'https://akis.ornek.test/ilan/1';
  v_r := public.radar_ingest(v_s1, jsonb_build_object('id', '00000000-0000-4000-8000-0000000000a2', 'status', 'ok'),
    jsonb_build_array(pg_temp.item('https://akis.ornek.test/ilan/1', 'Sentetik hastane yangın kapısı alımı', 'ankara:sentetik1', 85, true, 'Ankara', 'Etimesgut', current_date + 10, v_cats, v_cos)));
  if (v_r ->> 'items_new')::int <> 0 or (v_r ->> 'items_updated')::int <> 0 then raise exception 'TEST BAŞARISIZ: tekrar öğe yeni sayıldı %', v_r; end if;
  if (select count(*) from public.radar_items) <> 1 or (select last_seen_at from public.radar_items where canonical_url = 'https://akis.ornek.test/ilan/1') <= v_seen then
    raise exception 'TEST BAŞARISIZ: tekrar öğe last_seen güncellemedi';
  end if;
  if (select count(*) from public.notifications where dedupe_key like 'radar:%') <> 1 then raise exception 'TEST BAŞARISIZ: tekrar bildirim'; end if;
  raise notice 'PASS C: aynı öğe yeniden görülünce yalnız last_seen güncellenir; bildirim tekrarlanmaz (radar:<id>)';

  -- İçerik değişti → güncellendi
  v_r := public.radar_ingest(v_s1, jsonb_build_object('id', '00000000-0000-4000-8000-0000000000a3', 'status', 'ok'),
    jsonb_build_array(pg_temp.item('https://akis.ornek.test/ilan/1', 'Sentetik hastane yangın kapısı alımı (düzeltme)', 'ankara:sentetik1', 85, true, 'Ankara', 'Etimesgut', current_date + 10, v_cats, v_cos)));
  if (v_r ->> 'items_updated')::int <> 1 then raise exception 'TEST BAŞARISIZ: değişen içerik güncellenmedi'; end if;
  raise notice 'PASS C: içerik özeti değişince öğe güncellenir';

  -- İkinci kaynak, aynı küme → tek fırsat, iki öğe/kanıt, güvenilirlik +15; şehir çelişkisi riski
  v_r := public.radar_ingest(v_s2, jsonb_build_object('id', '00000000-0000-4000-8000-0000000000b1', 'status', 'ok'),
    jsonb_build_array(pg_temp.item('https://baska.ornek.test/haber/9', 'Sentetik hastane haberi', 'ankara:sentetik1', 40, false, 'Konya', null, null,
      '[{"key":"yangin_kapisi","need_status":"potansiyel","matched_terms":["haber"]}]'::jsonb)));
  select * into v_opp from public.radar_opportunities where cluster_key = 'ankara:sentetik1';
  if (select count(*) from public.radar_opportunities) <> 1 or (select count(*) from public.radar_items where opportunity_id = v_opp.id) <> 2
     or (select count(*) from public.radar_evidence where opportunity_id = v_opp.id) < 2 then
    raise exception 'TEST BAŞARISIZ: küme birleşmedi';
  end if;
  if v_opp.reliability <> 75 or v_opp.score <> 85 or v_opp.city <> 'Ankara' or not ('kaynak_celiskisi' = any (v_opp.risks)) then
    raise exception 'TEST BAŞARISIZ: birleşik alanlar (güvenilirlik %, puan %, şehir %, riskler %)', v_opp.reliability, v_opp.score, v_opp.city, v_opp.risks;
  end if;
  if (select need_status from public.radar_opportunity_categories where opportunity_id = v_opp.id and category_key = 'yangin_kapisi') <> 'dogrulanmis' then
    raise exception 'TEST BAŞARISIZ: doğrulanmış ihtiyaç potansiyele düştü';
  end if;
  raise notice 'PASS C: iki kaynak aynı proje → tek fırsat, iki kanıt; güvenilirlik +15; doğrulanmış ihtiyaç korunur; şehir çelişkisi risk olarak işaretlenir';

  -- Potansiyel fırsat: farklı başlık; "Doğrulanmış" yazılmaz
  perform public.radar_ingest(v_s2, jsonb_build_object('id', '00000000-0000-4000-8000-0000000000b2', 'status', 'ok'),
    jsonb_build_array(pg_temp.item('https://baska.ornek.test/haber/10', 'Sentetik otel inşaatı', 'ankara:sentetik2', 70, false, 'Ankara', null, null,
      '[{"key":"oda_kapisi","need_status":"potansiyel","matched_terms":["proje türü"]}]'::jsonb, '[]'::jsonb, 'x', 'yapim')));
  if (select count(*) from public.notifications n join public.radar_opportunities o on n.entity_id = o.id
      where o.cluster_key = 'ankara:sentetik2' and n.kind = 'radar_potansiyel' and n.title like 'Potansiyel ihtiyaç (doğrulanmadı):%') <> 1 then
    raise exception 'TEST BAŞARISIZ: potansiyel bildirim metni';
  end if;
  raise notice 'PASS C: potansiyel ihtiyaç bildirimi "Potansiyel ihtiyaç (doğrulanmadı)" olarak ayrışır';

  -- En düşük puan altı bildirilmez
  perform public.radar_ingest(v_s2, jsonb_build_object('id', '00000000-0000-4000-8000-0000000000b3', 'status', 'ok'),
    jsonb_build_array(pg_temp.item('https://baska.ornek.test/haber/11', 'Sentetik düşük puan', 'izmir:sentetik3', 20, false, 'İzmir', null, null, '[]'::jsonb)));
  if exists (select 1 from public.notifications n join public.radar_opportunities o on n.entity_id = o.id where o.cluster_key = 'izmir:sentetik3') then
    raise exception 'TEST BAŞARISIZ: en düşük puan altı bildirildi';
  end if;
  raise notice 'PASS C: en düşük puan altındaki fırsat bildirilmez';

  -- Etiket kuralı veritabanında
  begin
    update public.radar_opportunities set label = 'dogrulanmis_firsat' where cluster_key = 'ankara:sentetik2';
    raise exception 'TEST BAŞARISIZ: doğrulanmamış fırsat doğrulanmış etiketlendi';
  exception when check_violation then raise notice 'PASS C: doğrulanmış ihtiyaç yoksa "doğrulanmış iş fırsatı" etiketi veritabanında reddedilir';
  end;

  -- Bozuk öğe atlanır
  v_r := public.radar_ingest(v_s2, jsonb_build_object('id', '00000000-0000-4000-8000-0000000000b4', 'status', 'ok'),
    '[{"url_hash":"kotu","title":"x"}]'::jsonb);
  if (v_r ->> 'items_new')::int <> 0 then raise exception 'TEST BAŞARISIZ: bozuk öğe yazıldı'; end if;
  raise notice 'PASS C: doğrulamayı geçemeyen öğe atlanır';

  -- Hata ve geri çekilme: 2 ardışık hata → aralık × 4; başarı sıfırlar
  perform public.radar_ingest(v_s1, jsonb_build_object('id', gen_random_uuid(), 'status', 'hata', 'error', 'HTTP 500'), '[]'::jsonb);
  perform public.radar_ingest(v_s1, jsonb_build_object('id', gen_random_uuid(), 'status', 'hata', 'error', 'HTTP 500'), '[]'::jsonb);
  select * into v_src from public.radar_sources where id = v_s1;
  if v_src.consecutive_failures <> 2 or v_src.next_run_at < now() + interval '239 minutes' or v_src.next_run_at > now() + interval '241 minutes' or v_src.last_error <> 'HTTP 500' then
    raise exception 'TEST BAŞARISIZ: geri çekilme (% hata, %)', v_src.consecutive_failures, v_src.next_run_at - now();
  end if;
  perform public.radar_ingest(v_s1, jsonb_build_object('id', gen_random_uuid(), 'status', 'degismedi'), '[]'::jsonb);
  if (select consecutive_failures from public.radar_sources where id = v_s1) <> 0 then raise exception 'TEST BAŞARISIZ: başarı hatayı sıfırlamadı'; end if;
  raise notice 'PASS C: hata geri çekilmesi (aralık × 2^hata) ve başarıda sıfırlama';
  if (select items_new from public.radar_source_runs where id = '00000000-0000-4000-8000-0000000000a1') <> 1 then raise exception 'TEST BAŞARISIZ: çalıştırma kaydı'; end if;

  -- Kiralama: yalnız etkin + izinli
  update public.radar_sources set next_run_at = null where id in (v_s1, v_s2, current_setting('leonx.s3')::uuid);
  select count(*) into v_claimed from public.radar_service_claim_sources(10) c where c.permission_status = 'izinli';
  if v_claimed <> 2 or exists (select 1 from public.radar_service_claim_sources(10)) then
    raise exception 'TEST BAŞARISIZ: kiralama (%)', v_claimed;
  end if;
  raise notice 'PASS C: yalnız etkin + izinli kaynaklar kiralanır; kiralanan kaynak tekrar verilmez';

  -- Arama bütçesi: kapalıyken ret; aylık sınır dolunca ret
  if (public.radar_service_reserve_search() ->> 'granted')::boolean then raise exception 'TEST BAŞARISIZ: kapalı arama API bütçe aldı'; end if;
  update public.radar_settings set search_api_enabled = true, search_monthly_limit = 2;
  if not (public.radar_service_reserve_search() ->> 'granted')::boolean or not (public.radar_service_reserve_search() ->> 'granted')::boolean then
    raise exception 'TEST BAŞARISIZ: bütçe ayrılamadı';
  end if;
  v_r := public.radar_service_reserve_search();
  if (v_r ->> 'granted')::boolean or v_r ->> 'reason' <> 'aylık arama bütçesi doldu' then raise exception 'TEST BAŞARISIZ: bütçe sınırı %', v_r; end if;
  if (select calls from public.radar_search_usage) <> 2 then raise exception 'TEST BAŞARISIZ: sayaç'; end if;
  raise notice 'PASS C: arama API kapalıyken ve aylık bütçe dolunca çağrı izni verilmez (sayaç atomik)';
end;
$$;
reset role;

-- =====================================================================
-- D) SAHİP: durum geçmişi, sütun yetkileri, CRM aktarımı, iletişim, elle öğe, test sınırı
-- =====================================================================
set local role authenticated;
select pg_temp.act_as(current_setting('leonx.owner'));
do $$
declare
  v_opp uuid := current_setting('leonx.opp1')::uuid;
  v_rc uuid; v_r1 jsonb; v_r2 jsonb; v_r3 jsonb; v_i1 uuid; v_i2 uuid; v_n int; v_c public.companies;
begin
  update public.radar_opportunities set status = 'inceleniyor', status_note = 'Şartname istendi' where id = v_opp;
  update public.radar_opportunities set next_action = 'Telefonla ara' where id = v_opp;
  if (select count(*) from public.radar_actions where opportunity_id = v_opp) <> 1
     or (select note from public.radar_actions where opportunity_id = v_opp) <> 'Şartname istendi'
     or (select from_status || '>' || to_status from public.radar_actions where opportunity_id = v_opp) <> 'yeni>inceleniyor' then
    raise exception 'TEST BAŞARISIZ: durum geçmişi';
  end if;
  raise notice 'PASS D: durum değişikliği radar_actions geçmişine yazılır (yalnız durum değişince)';
  begin
    update public.radar_opportunities set score = 100 where id = v_opp;
    raise exception 'TEST BAŞARISIZ: istemci puanı değiştirdi';
  exception when insufficient_privilege then raise notice 'PASS D: istemci puan/doğrulama alanlarını değiştiremez';
  end;
  begin
    insert into public.radar_actions (opportunity_id, to_status) values (v_opp, 'kazanildi');
    raise exception 'TEST BAŞARISIZ: istemci geçmiş yazdı';
  exception when insufficient_privilege then raise notice 'PASS D: durum geçmişi istemciden yazılamaz';
  end;

  -- İletişim: kaynak ve doğrulama zamanı zorunlu
  select company_id into v_rc from public.radar_opportunity_companies where opportunity_id = v_opp;
  begin
    insert into public.radar_contacts (company_id, kind, value, verified_at) values (v_rc, 'genel_eposta', 'info@sentetikyapi.test', now());
    raise exception 'TEST BAŞARISIZ: kaynaksız iletişim kabul edildi';
  exception when not_null_violation then raise notice 'PASS D: iletişim kaydı kaynak adresi olmadan yazılamaz';
  end;
  begin
    insert into public.radar_contacts (company_id, kind, value, source_url) values (v_rc, 'genel_eposta', 'info@sentetikyapi.test', 'https://sentetikyapi.test/iletisim');
    raise exception 'TEST BAŞARISIZ: doğrulama zamansız iletişim kabul edildi';
  exception when not_null_violation then raise notice 'PASS D: iletişim kaydı doğrulama zamanı olmadan yazılamaz';
  end;
  begin
    insert into public.radar_contacts (company_id, kind, value, source_url, verified_at) values (v_rc, 'satinalma_eposta', 'telefon-degil', 'https://sentetikyapi.test/', now());
    raise exception 'TEST BAŞARISIZ: geçersiz e-posta kabul edildi';
  exception when check_violation then raise notice 'PASS D: iletişim değeri türüne göre doğrulanır';
  end;
  insert into public.radar_contacts (company_id, kind, value, source_url, verified_at)
  values (v_rc, 'satinalma_eposta', 'satinalma@sentetikyapi.test', 'https://sentetikyapi.test/iletisim', now()),
         (v_rc, 'telefon', '+90 312 000 00 00', 'https://sentetikyapi.test/iletisim', now());

  -- CRM aktarımı: tekrarlanabilir
  v_r1 := public.radar_import_to_crm(v_opp, v_rc, false);
  v_r2 := public.radar_import_to_crm(v_opp, v_rc, true);
  v_r3 := public.radar_import_to_crm(v_opp, v_rc, true);
  if v_r1 ->> 'company_id' is null or v_r1 ->> 'company_id' <> v_r2 ->> 'company_id' or v_r2 ->> 'project_id' is null or v_r2 ->> 'project_id' <> v_r3 ->> 'project_id' then
    raise exception 'TEST BAŞARISIZ: CRM aktarımı tekrarlanabilir değil % % %', v_r1, v_r2, v_r3;
  end if;
  select * into v_c from public.companies where id = (v_r1 ->> 'company_id')::uuid;
  if v_c.name <> 'Sentetik Yapı A.Ş.' or v_c.email <> 'satinalma@sentetikyapi.test' or v_c.phone <> '+90 312 000 00 00' then raise exception 'TEST BAŞARISIZ: firma alanları'; end if;
  if (select count(*) from public.companies where name = 'Sentetik Yapı A.Ş.') <> 1 or (select count(*) from public.projects where id = (v_r2 ->> 'project_id')::uuid and stage = 'yeni_firsat' and category = 'yangin_kapisi' and location = 'Etimesgut / Ankara') <> 1 then
    raise exception 'TEST BAŞARISIZ: CRM kayıtları';
  end if;
  if (select crm_company_id::text || project_id::text from public.radar_opportunities where id = v_opp) <> (v_r1 ->> 'company_id') || (v_r2 ->> 'project_id') then raise exception 'TEST BAŞARISIZ: fırsat bağlantıları'; end if;
  raise notice 'PASS D: CRM aktarımı yalnız radar firma verisi + kaynaklı iletişimle; tekrar çağrıda çift kayıt yok; proje adayı bir kez';

  -- Elle öğe: sunucuda temizlenir, bekliyor; aynı adres tekil
  v_i1 := public.radar_add_manual_item('https://haber.ornek.test/elle#x', '<b>Pursaklar okul</b> yangın kapısı', '<p>Metin</p><script>alert(1)</script> &amp; devam');
  v_i2 := public.radar_add_manual_item('https://haber.ornek.test/elle', 'Pursaklar okul yangın kapısı', 'Metin');
  if v_i1 <> v_i2 then raise exception 'TEST BAŞARISIZ: aynı adres iki öğe'; end if;
  if (select raw_text from public.radar_items where id = v_i1) <> 'Metin' or (select title from public.radar_items where id = v_i1) <> 'Pursaklar okul yangın kapısı'
     or not (select pending from public.radar_items where id = v_i1) then
    raise exception 'TEST BAŞARISIZ: elle öğe temizlenmedi: %', (select raw_text from public.radar_items where id = v_i1);
  end if;
  if (select count(*) from public.radar_sources where kind = 'manual' and name = 'Elle eklenen bağlantılar' and not active and permission_status = 'inceleniyor') <> 1 then
    raise exception 'TEST BAŞARISIZ: elle kaynak';
  end if;
  begin
    perform public.radar_add_manual_item('javascript:alert(1)', 'x', 'y');
    raise exception 'TEST BAŞARISIZ: geçersiz adres kabul edildi';
  exception when check_violation then raise notice 'PASS D: elle öğe metni sunucuda temizlenir, bekliyor olarak kaydedilir, adres tekil; geçersiz adres reddedilir';
  end;

  -- Kaynak testi hız sınırı
  if not public.radar_claim_source_test(current_setting('leonx.s3')::uuid) or public.radar_claim_source_test(current_setting('leonx.s3')::uuid) then
    raise exception 'TEST BAŞARISIZ: test hız sınırı';
  end if;
  raise notice 'PASS D: "Kaynağı test et" kaynak başına 5 dakikada bir';

  -- E-posta taslağı: yalnız kayıt (gönderim sütunu/işlevi yok)
  insert into public.radar_outreach_drafts (opportunity_id, company_id, subject, body) values (v_opp, v_rc, 'Konu', 'Gövde');
  if exists (select 1 from information_schema.columns where table_name = 'radar_outreach_drafts' and column_name in ('sent_at', 'send_at', 'recipient')) then
    raise exception 'TEST BAŞARISIZ: taslak tablosunda gönderim alanı var';
  end if;
  raise notice 'PASS D: e-posta taslağı yalnız saklanır (otomatik gönderim alanı yok)';
end;
$$;
reset role;

-- Bildirim tercihi: 'firsat' kategorisi kapatılınca radar bildirimi üretilmez (leonx_notify yeni dalı)
set local role authenticated;
select pg_temp.act_as(current_setting('leonx.owner'));
insert into public.notification_prefs (cat_firsat) values (false)
  on conflict (user_id) do update set cat_firsat = false;
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
begin
  perform public.radar_ingest(current_setting('leonx.s2')::uuid, jsonb_build_object('id', gen_random_uuid(), 'status', 'ok'),
    jsonb_build_array(pg_temp.item('https://baska.ornek.test/haber/12', 'Sentetik AVM projesi', 'ankara:sentetik4', 90, false, 'Ankara', null, null,
      '[{"key":"giydirme_cephe","need_status":"potansiyel","matched_terms":["proje türü"]}]'::jsonb)));
  if exists (select 1 from public.notifications n join public.radar_opportunities o on n.entity_id = o.id where o.cluster_key = 'ankara:sentetik4') then
    raise exception 'TEST BAŞARISIZ: fırsat bildirimi kapalıyken bildirim üretildi';
  end if;
  if exists (select 1 from public.notifications where category <> 'firsat' and dedupe_key like 'radar:%') then
    raise exception 'TEST BAŞARISIZ: radar bildirimi yanlış kategoride';
  end if;
  raise notice 'PASS D: bildirim tercihlerinde "fırsat" kapalıyken radar bildirimi üretilmez';
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
  foreach t in array array['radar_settings', 'radar_sources', 'radar_items', 'radar_opportunities', 'radar_evidence', 'radar_companies', 'radar_contacts', 'radar_actions', 'radar_outreach_drafts'] loop
    execute format('select count(*) from public.%I', t) into v_n;
    if v_n <> 0 then raise exception 'TEST BAŞARISIZ: yetkisiz hesap % içinde % satır gördü', t, v_n; end if;
  end loop;
  raise notice 'PASS E: yetkisiz hesap hiçbir radar verisini göremez';
  begin
    perform public.radar_import_to_crm(current_setting('leonx.opp1')::uuid, null, true);
    raise exception 'TEST BAŞARISIZ: yetkisiz CRM aktarımı';
  exception when insufficient_privilege then raise notice 'PASS E: CRM aktarımı yalnız sahip çağırabilir';
  end;
  begin
    perform public.radar_add_manual_item('https://x.ornek.test/a', 'x', 'y');
    raise exception 'TEST BAŞARISIZ: yetkisiz elle öğe';
  exception when insufficient_privilege then raise notice 'PASS E: yetkisiz hesap elle öğe ekleyemez';
  end;
  begin
    insert into public.radar_sources (name, kind, url) values ('Sızma', 'rss', 'https://x.ornek.test/rss');
    raise exception 'TEST BAŞARISIZ: yetkisiz kaynak ekledi';
  exception when insufficient_privilege then raise notice 'PASS E: yetkisiz hesap kaynak ekleyemez';
  end;
  update public.radar_opportunities set status = 'ilgisiz';
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'TEST BAŞARISIZ: yetkisiz durum değiştirdi'; end if;
  raise notice 'PASS E: yetkisiz hesap fırsat durumunu değiştiremez';
end;
$$;
reset role;

do $$ begin raise notice 'TESTLER BAŞARILI (radar)'; end $$;
rollback;
