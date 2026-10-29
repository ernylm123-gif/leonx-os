-- =====================================================================
-- LEONX OS — 018: Radar işletim testleri (kaynak doğrulama kuralı, ret nedenleri, işletim özeti, günlük rapor)
-- Tek işlem içinde çalışır ve sonunda ROLLBACK yapar; kalıcı veri bırakmaz. Tüm veriler SENTETİKTİR.
-- =====================================================================
begin;

select set_config('leonx.owner', (select user_id::text from public.app_owner), true);

create or replace function pg_temp.act_as(p_user text)
returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- A) Yetkiler
do $$
declare f text;
begin
  foreach f in array array['public.radar_service_save_verification(uuid, jsonb)', 'public.radar_service_record_rejects(uuid, integer, jsonb)', 'public.radar_ops_snapshot()'] loop
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') then
      raise exception 'TEST BAŞARISIZ: % istemciye açık', f;
    end if;
  end loop;
  if not has_function_privilege('service_role', 'public.radar_service_save_verification(uuid, jsonb)', 'execute') then
    raise exception 'TEST BAŞARISIZ: doğrulama kaydı service_role için kapalı';
  end if;
  if has_function_privilege('anon', 'public.radar_ops()', 'execute') or not has_function_privilege('authenticated', 'public.radar_ops()', 'execute') then
    raise exception 'TEST BAŞARISIZ: radar_ops yetkisi yanlış';
  end if;
  raise notice 'PASS A: doğrulama/ret RPCleri yalnız service_role; radar_ops yalnız oturumlu (sahip)';
end;
$$;

-- B) Sahip doğrulanmamış kaynağı İzinli yapamaz ve doğrulama alanını kendisi yazamaz
insert into public.radar_sources (name, kind, url, allowed_hosts, permission_status)
values ('Sentetik belediye ilanları', 'site', 'https://ihale.ornek.test/ihaleler', array['ihale.ornek.test'], 'inceleniyor');
select set_config('leonx.src', (select id::text from public.radar_sources where url = 'https://ihale.ornek.test/ihaleler'), true);

set local role authenticated;
select pg_temp.act_as(current_setting('leonx.owner'));
do $$
begin
  begin
    update public.radar_sources set permission_status = 'izinli', active = true where id = current_setting('leonx.src')::uuid;
    raise exception 'TEST BAŞARISIZ: doğrulanmamış kaynak izinli yapıldı';
  exception when check_violation then null;
  end;
  begin
    update public.radar_sources set verification = '{"ok": true}', verified_at = now() where id = current_setting('leonx.src')::uuid;
    raise exception 'TEST BAŞARISIZ: istemci doğrulama alanını yazdı';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.radar_sources (name, kind, url, permission_status, active, verification, verified_at)
    values ('Sahte izinli', 'rss', 'https://sahte.ornek.test/rss', 'izinli', true, '{"ok": true}', now());
    raise exception 'TEST BAŞARISIZ: istemci doğrulanmış kaynak ekledi';
  exception when insufficient_privilege or check_violation then null;
  end;
  raise notice 'PASS B: doğrulanmamış kaynak izinli yapılamaz; doğrulama alanları istemciden yazılamaz';
end;
$$;
reset role;

-- C) Sunucu doğrulaması: başarılı → izinli yapılabilir; başarısız → izinli kaynak İnceleniyor + pasif olur
do $$
declare v jsonb;
begin
  v := public.radar_service_save_verification(current_setting('leonx.src')::uuid, '{"ok": false, "blockers": ["robots"]}');
  if (v ->> 'ok')::boolean then raise exception 'TEST BAŞARISIZ: başarısız doğrulama ok döndü'; end if;
  begin
    update public.radar_sources set permission_status = 'izinli' where id = current_setting('leonx.src')::uuid;
    raise exception 'TEST BAŞARISIZ: başarısız doğrulamadan sonra izinli yapıldı';
  exception when check_violation then null;
  end;
  perform public.radar_service_save_verification(current_setting('leonx.src')::uuid, '{"ok": true, "items": 12}');
  update public.radar_sources set permission_status = 'izinli', active = true where id = current_setting('leonx.src')::uuid;
  v := public.radar_service_save_verification(current_setting('leonx.src')::uuid, '{"ok": false, "blockers": ["http_403"]}');
  if v ->> 'permission_status' <> 'inceleniyor' or (v ->> 'active')::boolean then
    raise exception 'TEST BAŞARISIZ: başarısız yeniden doğrulama kaynağı kapatmadı: %', v;
  end if;
  perform public.radar_service_save_verification(current_setting('leonx.src')::uuid, '{"ok": true, "items": 12}');
  update public.radar_sources set permission_status = 'izinli', active = true where id = current_setting('leonx.src')::uuid;
  update public.radar_sources set url = 'https://ihale.ornek.test/duyurular' where id = current_setting('leonx.src')::uuid;
  if (select permission_status <> 'inceleniyor' or active or verified_at is not null from public.radar_sources where id = current_setting('leonx.src')::uuid) then
    raise exception 'TEST BAŞARISIZ: adres değişince doğrulama düşmedi';
  end if;
  update public.radar_sources set url = 'https://ihale.ornek.test/ihaleler' where id = current_setting('leonx.src')::uuid;
  perform public.radar_service_save_verification(current_setting('leonx.src')::uuid, '{"ok": true, "items": 12}');
  update public.radar_sources set permission_status = 'izinli', active = true where id = current_setting('leonx.src')::uuid;
  raise notice 'PASS C: sunucu doğrulaması izni açar; başarısız yeniden doğrulama kaynağı İnceleniyor + pasif yapar';
end;
$$;

-- D) Ret nedenleri ve işletim özeti = veritabanı değerleri
do $$
declare v_run uuid := gen_random_uuid(); o jsonb; r jsonb;
begin
  perform public.radar_ingest(current_setting('leonx.src')::uuid,
    jsonb_build_object('id', v_run, 'status', 'ok', 'http_status', 200, 'started_at', now(), 'finished_at', now()), '[]'::jsonb);
  perform public.radar_service_record_rejects(v_run, 3, '{"insaat_disi": 2, "urun_yok": 1}');
  perform public.radar_service_record_rejects(v_run, 1, '{"insaat_disi": 1, "BOZUK KOD": 9}');
  if (select items_rejected from public.radar_source_runs where id = v_run) <> 4
     or (select reject_reasons from public.radar_source_runs where id = v_run) <> '{"insaat_disi": 3, "urun_yok": 1}'::jsonb then
    raise exception 'TEST BAŞARISIZ: ret sayıları birikmedi: %', (select reject_reasons from public.radar_source_runs where id = v_run);
  end if;
  o := public.radar_ops_snapshot();
  if (o ->> 'active_sources')::integer <> (select count(*) from public.radar_sources where active and permission_status = 'izinli' and kind <> 'manual')
     or (o ->> 'items_rejected_24h')::integer <> (select sum(items_rejected) from public.radar_source_runs where started_at >= now() - interval '24 hours')
     or (o -> 'reject_reasons_24h' ->> 'insaat_disi')::integer < 3
     or (o ->> 'opportunities_total')::integer <> (select count(*) from public.radar_opportunities)
     or (o ->> 'last_success_at') is null then
    raise exception 'TEST BAŞARISIZ: işletim özeti veritabanıyla uyuşmuyor: %', o;
  end if;
  raise notice 'PASS D: ret nedenleri birikir (geçersiz kod yok sayılır); işletim özeti sayıları veritabanıyla aynı';

  -- E) Günlük rapor sıfır fırsatta da üretilir ve bildirilir
  perform public.radar_build_report('gunluk');
  r := (select payload from public.radar_reports where kind = 'gunluk' order by created_at desc limit 1);
  if r -> 'sources' ->> 'items_rejected_24h' is null then raise exception 'TEST BAŞARISIZ: rapora tarama sayıları eklenmedi: %', r; end if;
  if not exists (select 1 from public.notifications where kind = 'radar_rapor' and title like 'LEONX Radar günlük satış raporu:%') then
    raise exception 'TEST BAŞARISIZ: günlük rapor bildirimi oluşmadı';
  end if;
  raise notice 'PASS E: günlük rapor her gün üretilir ve bildirilir (sıfır sonuç dahil)';
end;
$$;

do $$ begin raise notice 'TÜM RADAR İŞLETİM TESTLERİ BAŞARILI'; end $$;
rollback;
