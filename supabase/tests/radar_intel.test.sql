-- =====================================================================
-- LEONX OS — 016: Radar zamanlanmış istihbarat testleri
-- Tek işlem içinde çalışır ve sonunda ROLLBACK yapar; kalıcı veri bırakmaz.
-- Tüm fırsat verileri SENTETİKTİR.
-- =====================================================================
begin;

select set_config('leonx.owner', (select user_id::text from public.app_owner), true);

create or replace function pg_temp.act_as(p_user text)
returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

create or replace function pg_temp.opp(p_title text, p_key text, p_score int, p_verified boolean, p_deadline date, p_status text default 'yeni')
returns uuid language sql as $$
  insert into public.radar_opportunities (title, city, is_ankara, stage, deadline, score, verified_need, label, status, cluster_key)
  values (p_title, 'Ankara', true, 'ihale', p_deadline, p_score, p_verified,
          case when p_verified then 'dogrulanmis_firsat' else 'potansiyel_ihtiyac' end, p_status, p_key)
  returning id;
$$;

-- =====================================================================
-- A) YETKİLER
-- =====================================================================
do $$
declare f text;
begin
  foreach f in array array['public.radar_build_report(text)', 'public.radar_notify_updates()', 'public.radar_health_snapshot()',
    'public.radar_health_check()', 'public.tg_radar_changes()'] loop
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') then
      raise exception 'TEST BAŞARISIZ: % istemciye açık', f;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.radar_health()', 'execute') or has_function_privilege('anon', 'public.radar_create_task(uuid, text, date)', 'execute') then
    raise exception 'TEST BAŞARISIZ: sahip RPCsi anon için açık';
  end if;
  if has_table_privilege('authenticated', 'leonx_private.release_watch', 'select') then raise exception 'TEST BAŞARISIZ: release_watch istemciye açık'; end if;
  if has_table_privilege('authenticated', 'public.radar_reports', 'insert') or has_table_privilege('authenticated', 'public.radar_changes', 'update') then
    raise exception 'TEST BAŞARISIZ: rapor/değişiklik tablosu istemciden yazılabilir';
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relname in ('radar_reports', 'radar_changes') and not c.relrowsecurity) then
    raise exception 'TEST BAŞARISIZ: RLS kapalı';
  end if;
  raise notice 'PASS A: rapor/bildirim/sağlık işlevleri istemciye kapalı; tablolar RLS açık ve salt okunur';
end;
$$;

-- =====================================================================
-- B) DEĞİŞİKLİK KAYDI VE BİLDİRİMİ
-- =====================================================================
do $$
declare
  v_o uuid := pg_temp.opp('Sentetik hastane kapı ihalesi', 'sentetik-degisim', 80, false, null);
  v_n integer;
begin
  update public.radar_opportunities set stage = 'yapim' where id = v_o;
  if exists (select 1 from public.radar_changes where opportunity_id = v_o) then
    raise exception 'TEST BAŞARISIZ: bildirilmemiş fırsat için değişiklik kaydedildi';
  end if;
  update public.radar_opportunities set notified_at = now() where id = v_o;
  update public.radar_opportunities set stage = 'ihale', deadline = current_date + 20, verified_need = true, label = 'dogrulanmis_firsat' where id = v_o;
  select count(*) into v_n from public.radar_changes where opportunity_id = v_o;
  if v_n <> 4 then raise exception 'TEST BAŞARISIZ: 4 değişiklik bekleniyordu, %', v_n; end if;
  -- sessiz saat olmasın
  update public.radar_settings set quiet_start = null, quiet_end = null where singleton;
  perform public.radar_notify_updates();
  select count(*) into v_n from public.notifications where entity_id = v_o and kind = 'radar_degisiklik';
  if v_n <> 1 then raise exception 'TEST BAŞARISIZ: tek birleşik değişiklik bildirimi bekleniyordu, %', v_n; end if;
  if exists (select 1 from public.radar_changes where opportunity_id = v_o and notified_at is null) then
    raise exception 'TEST BAŞARISIZ: değişiklikler bildirildi olarak işaretlenmedi';
  end if;
  perform public.radar_notify_updates();
  select count(*) into v_n from public.notifications where entity_id = v_o and kind = 'radar_degisiklik';
  if v_n <> 1 then raise exception 'TEST BAŞARISIZ: değişiklik bildirimi tekrarlandı'; end if;
  raise notice 'PASS B: önemli değişiklikler kaydedilir, fırsat başına tek bildirim, tekrar yok';
end;
$$;

-- =====================================================================
-- C) SON TARİH HATIRLATMASI
-- =====================================================================
do $$
declare
  v_today date := (now() at time zone 'Europe/Istanbul')::date;
  v_a uuid := pg_temp.opp('Sentetik yangın kapısı ihalesi', 'sentetik-son-3', 70, true, v_today + 3);
  v_b uuid := pg_temp.opp('Sentetik potansiyel konut', 'sentetik-son-pot', 70, false, v_today + 3);
  v_c uuid := pg_temp.opp('Sentetik takip edilen', 'sentetik-son-takip', 70, false, v_today + 1, 'inceleniyor');
  v_d uuid := pg_temp.opp('Sentetik ilgisiz', 'sentetik-son-ilgisiz', 70, true, v_today + 1, 'ilgisiz');
  v_e uuid := pg_temp.opp('Sentetik 5 gün', 'sentetik-son-5', 70, true, v_today + 5);
  v_n integer;
begin
  perform public.radar_notify_updates();
  perform public.radar_notify_updates();
  if extract(hour from (now() at time zone 'Europe/Istanbul')) < 8 then
    if exists (select 1 from public.notifications where kind = 'radar_son_tarih') then
      raise exception 'TEST BAŞARISIZ: 08:00 öncesi son tarih hatırlatması gönderildi';
    end if;
    raise notice 'PASS C: 08:00 öncesi hatırlatma gönderilmez (eşik kontrolleri saat 08:00 sonrası çalıştırmada)';
    return;
  end if;
  if (select count(*) from public.notifications where entity_id = v_a and dedupe_key = 'radar:son:' || v_a || ':3') <> 1 then
    raise exception 'TEST BAŞARISIZ: doğrulanmış fırsat için 3 gün hatırlatması yok/tekrarlı';
  end if;
  if exists (select 1 from public.notifications where entity_id in (v_b, v_d, v_e) and kind = 'radar_son_tarih') then
    raise exception 'TEST BAŞARISIZ: takip edilmeyen/ilgisiz/eşik dışı fırsata hatırlatma gitti';
  end if;
  if not exists (select 1 from public.notifications where entity_id = v_c and kind = 'radar_son_tarih') then
    raise exception 'TEST BAŞARISIZ: takip edilen fırsata hatırlatma gitmedi';
  end if;
  raise notice 'PASS C: son tarih hatırlatmaları yalnız takip edilen/doğrulanmış açık fırsatlara, eşik başına bir kez';
end;
$$;

-- =====================================================================
-- D) RAPORLAR
-- =====================================================================
do $$
declare
  v_id  uuid;
  v_id2 uuid;
  v_p   jsonb;
  v_w   uuid := pg_temp.opp('Sentetik bekleyen takip', 'sentetik-takip', 90, true, null, 'iletisime_gecildi');
begin
  v_id := public.radar_build_report('gunluk');
  v_id2 := public.radar_build_report('gunluk');
  if v_id is null or v_id <> v_id2 or (select count(*) from public.radar_reports where kind = 'gunluk') <> 1 then
    raise exception 'TEST BAŞARISIZ: günlük rapor tekilleştirilmedi';
  end if;
  select payload into v_p from public.radar_reports where id = v_id;
  if (v_p ->> 'new_count')::int < 1 or jsonb_array_length(v_p -> 'top') < 1 or not (v_p ? 'sources') then
    raise exception 'TEST BAŞARISIZ: günlük rapor içeriği eksik: %', v_p;
  end if;
  if (select count(*) from public.notifications where kind = 'radar_rapor' and dedupe_key like 'radar:rapor:gunluk:%') <> 1 then
    raise exception 'TEST BAŞARISIZ: günlük rapor bildirimi tek değil';
  end if;
  -- haftalık: 8 gündür dokunulmamış takip
  alter table public.radar_opportunities disable trigger touch_row;
  update public.radar_opportunities set updated_at = now() - interval '8 days' where id = v_w;
  alter table public.radar_opportunities enable trigger touch_row;
  v_id := public.radar_build_report('haftalik');
  select payload into v_p from public.radar_reports where id = v_id;
  if not exists (select 1 from jsonb_array_elements(v_p -> 'follow_ups') x where (x ->> 'id')::uuid = v_w) then
    raise exception 'TEST BAŞARISIZ: haftalık özet hareketsiz takibi göstermedi';
  end if;
  if not (v_p -> 'pipeline' ? 'iletisime_gecildi') then raise exception 'TEST BAŞARISIZ: hat dağılımı eksik'; end if;
  begin
    perform public.radar_build_report('aylik');
    raise exception 'TEST BAŞARISIZ: geçersiz rapor türü kabul edildi';
  exception when sqlstate '22023' then null;
  end;
  raise notice 'PASS D: günlük ve haftalık raporlar üretilir, dönem başına tek kayıt ve tek bildirim';
end;
$$;

-- =====================================================================
-- E) SAĞLIK
-- =====================================================================
do $$
declare
  v_s uuid;
  v_n integer;
begin
  insert into public.radar_sources (name, kind, url, permission_status, active, consecutive_failures)
  values ('Sentetik akış', 'rss', 'https://ornek.test/akis.xml', 'izinli', true, 4) returning id into v_s;
  update leonx_private.radar_config set scan_url = 'https://ornek.test/functions/v1/radar-scan' where singleton;
  perform public.radar_health_check();
  perform public.radar_health_check();
  select count(*) into v_n from public.notifications where kind = 'radar_saglik';
  if v_n <> 2 then raise exception 'TEST BAŞARISIZ: kaynak hatası + duran tarama için 2 bildirim bekleniyordu, %', v_n; end if;
  -- sahip RPC'si
  set local role authenticated;
  perform pg_temp.act_as(current_setting('leonx.owner'));
  if (public.radar_health() ->> 'active_sources')::int < 1 then raise exception 'TEST BAŞARISIZ: sağlık özeti'; end if;
  perform pg_temp.act_as(gen_random_uuid()::text);
  begin
    perform public.radar_health();
    raise exception 'TEST BAŞARISIZ: yabancı kullanıcı sağlık özetini okudu';
  exception when insufficient_privilege then null;
  end;
  reset role;
  raise notice 'PASS E: sağlık denetimi hatalı kaynak ve duran taramayı günde bir kez bildirir; özet yalnız sahibe';
end;
$$;

-- =====================================================================
-- F) SÜRÜM İZLEME (pg_net yoksa yalnız yanıt işleme mantığı)
-- =====================================================================
do $$
begin
  -- adres yokken hiçbir şey yapmaz
  perform leonx_private.check_release();
  if (select pending_id from leonx_private.release_watch where singleton) is not null then
    raise exception 'TEST BAŞARISIZ: adres boşken istek atıldı';
  end if;
  begin
    update leonx_private.release_watch set version_url = 'http://ornek.test/version.json' where singleton;
    raise exception 'TEST BAŞARISIZ: https olmayan sürüm adresi kabul edildi';
  exception when check_violation then null;
  end;
  raise notice 'PASS F: sürüm izleme varsayılan kapalı; yalnız https …/version.json kabul edilir';
end;
$$;

-- Yanıt işleme: pg_net yoksa yanıt tablosu bu işlem içinde taklit edilir (ROLLBACK ile kalkar)
do $$
declare
  v_body text := '{"version":"0.12.0","commit":"abc1234","env":"production","buildId":"0.12.0+abc1234.test"}';
begin
  if to_regprocedure('net.http_get(text,jsonb,jsonb,integer)') is not null then
    raise notice 'PASS F2: atlandı (gerçek pg_net kurulu; yanıt taklidi yapılmaz)';
    return;
  end if;
  create schema if not exists net;
  create table if not exists net._http_response (id bigint primary key, status_code integer, content text);
  insert into net._http_response values (901, 200, v_body), (902, 200, replace(v_body, 'production', 'preview')), (903, 500, null);

  -- ilk okuma yalnız temel alınır, bildirim yok
  update leonx_private.release_watch set version_url = 'https://ornek.test/version.json', pending_id = 901, last_build_id = null where singleton;
  perform leonx_private.check_release();
  if (select last_build_id from leonx_private.release_watch) <> '0.12.0+abc1234.test'
     or exists (select 1 from public.notifications where kind = 'surum_yeni') then
    raise exception 'TEST BAŞARISIZ: ilk sürüm okuması temel alınmadı veya bildirim üretti';
  end if;
  -- yeni production derlemesi → tek bildirim, istemciyle aynı anahtar
  update leonx_private.release_watch set last_build_id = '0.11.0+eski.test', pending_id = 901 where singleton;
  perform leonx_private.check_release();
  update leonx_private.release_watch set last_build_id = '0.11.0+eski.test', pending_id = 901 where singleton;
  perform leonx_private.check_release();
  if (select count(*) from public.notifications where dedupe_key = 'surum_yeni:0.12.0+abc1234.test') <> 1 then
    raise exception 'TEST BAŞARISIZ: yeni sürüm bildirimi tek değil';
  end if;
  -- preview derlemesi ve HTTP hatası bildirim üretmez, hata kaydedilir
  update leonx_private.release_watch set last_build_id = 'x', pending_id = 902 where singleton;
  perform leonx_private.check_release();
  update leonx_private.release_watch set pending_id = 903 where singleton;
  perform leonx_private.check_release();
  if (select count(*) from public.notifications where kind = 'surum_yeni') <> 1
     or (select last_build_id from leonx_private.release_watch) <> 'x'
     or (select last_error from leonx_private.release_watch) <> 'HTTP 500' then
    raise exception 'TEST BAŞARISIZ: preview/hata yanıtı yanlış işlendi';
  end if;
  raise notice 'PASS F2: yeni production derlemesi bir kez bildirilir (istemciyle aynı anahtar); preview ve HTTP hatası bildirilmez';
end;
$$;

-- =====================================================================
-- G) FIRSATTAN GÖREV
-- =====================================================================
set local role authenticated;
select pg_temp.act_as(current_setting('leonx.owner'));
do $$
declare
  v_o uuid;
  r1  jsonb;
  r2  jsonb;
begin
  select id into v_o from public.radar_opportunities where cluster_key = 'sentetik-son-3';
  r1 := public.radar_create_task(v_o, 'Teknik şartnameyi iste', null);
  r2 := public.radar_create_task(v_o, 'Keşif randevusu', current_date + 2);
  if r1 ->> 'project_id' is null or r1 ->> 'project_id' <> r2 ->> 'project_id' then
    raise exception 'TEST BAŞARISIZ: görevler aynı proje adayına bağlanmadı';
  end if;
  if (select priority from public.project_tasks where id = (r1 ->> 'task_id')::uuid) <> 'acil' then
    raise exception 'TEST BAŞARISIZ: son tarihi yakın fırsat görevi acil değil';
  end if;
  if (select due_date from public.project_tasks where id = (r1 ->> 'task_id')::uuid) is null then
    raise exception 'TEST BAŞARISIZ: son tarih görev bitişine aktarılmadı';
  end if;
  begin
    perform public.radar_create_task(v_o, '   ', null);
    raise exception 'TEST BAŞARISIZ: boş başlık kabul edildi';
  exception when sqlstate '22023' then null;
  end;
  perform pg_temp.act_as(gen_random_uuid()::text);
  begin
    perform public.radar_create_task(v_o, 'Yetkisiz', null);
    raise exception 'TEST BAŞARISIZ: yabancı kullanıcı görev oluşturdu';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS G: fırsattan görev — proje adayı tekrar kullanılır, öncelik/bitiş son tarihten, yalnız sahip';
end;
$$;
reset role;

do $$ begin raise notice 'TESTLER BAŞARILI (radar istihbarat)'; end $$;
rollback;
