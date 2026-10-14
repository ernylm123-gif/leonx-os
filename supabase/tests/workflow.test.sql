-- =====================================================================
-- LEONX OS — Faz 7: aşamalar, görevler, zaman çizelgesi, bildirimler, push, hatırlatmalar
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
-- A) ANON ve YETKİSİZ ERİŞİM
-- =====================================================================
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
declare t text;
begin
  foreach t in array array['project_tasks', 'project_events', 'notifications', 'notification_prefs', 'push_subscriptions'] loop
    begin
      execute format('select count(*) from public.%I', t);
      raise exception 'TEST BAŞARISIZ: anon % okuyabildi', t;
    exception when insufficient_privilege then
      raise notice 'PASS A: anon % okuyamaz', t;
    end;
  end loop;
  begin
    perform public.push_public_key();
    raise exception 'TEST BAŞARISIZ: anon push_public_key çağırdı';
  exception when insufficient_privilege then raise notice 'PASS A: anon push anahtarını alamaz';
  end;
  begin
    perform public.check_reminders();
    raise exception 'TEST BAŞARISIZ: anon check_reminders çağırdı';
  exception when insufficient_privilege then raise notice 'PASS A: anon hatırlatma tetikleyemez';
  end;
end;
$$;
reset role;

-- =====================================================================
-- B) SAHİP: aşama eşitlemesi, görev, zaman çizelgesi, bildirim
-- =====================================================================
set local role authenticated;
select pg_temp.act_as(current_setting('leonx.owner'));

do $$
declare
  v_company uuid; v_p uuid; v_p2 uuid; v_t uuid; v_q uuid; v_row public.projects; v_n int; v_s text;
begin
  insert into public.companies (name) values ('Faz7 Test Firma') returning id into v_company;
  select count(*) into v_n from public.notifications where kind = 'musteri_yeni' and entity_id = v_company;
  if v_n <> 1 then raise exception 'TEST BAŞARISIZ: yeni müşteri bildirimi %', v_n; end if;
  raise notice 'PASS B: yeni müşteri bildirimi';

  -- Yeni istemci: aşama gönderir → eski durum türetilir
  insert into public.projects (code, name, category, company_id, stage) values ('LX-F7-1', 'Faz7 proje', 'cephe', v_company, 'uretimde')
  returning * into v_row;
  v_p := v_row.id;
  if v_row.status <> 'uretim' or v_row.progress < 55 then raise exception 'TEST BAŞARISIZ: aşama→durum % %', v_row.status, v_row.progress; end if;
  raise notice 'PASS B: aşama → eski durum ve asgari ilerleme';

  -- Eski istemci: yalnız durum gönderir → aşama türetilir
  insert into public.projects (code, name, category, status) values ('LX-F7-2', 'Eski istemci', 'pvc_dograma', 'montaj') returning * into v_row;
  v_p2 := v_row.id;
  if v_row.stage <> 'montajda' then raise exception 'TEST BAŞARISIZ: durum→aşama %', v_row.stage; end if;
  update public.projects set status = 'beklemede' where id = v_p2 returning * into v_row;
  if not v_row.on_hold or v_row.stage <> 'montajda' then raise exception 'TEST BAŞARISIZ: beklemede bayrağı'; end if;
  update public.projects set status = 'tamamlandi' where id = v_p2 returning * into v_row;
  if v_row.stage <> 'tamamlandi' or v_row.on_hold or v_row.completed_on is null or v_row.progress <> 100 then
    raise exception 'TEST BAŞARISIZ: eski istemci tamamlama % % %', v_row.stage, v_row.on_hold, v_row.completed_on;
  end if;
  raise notice 'PASS B: eski istemci durum değişiklikleri aşamaya yansır (beklemede, tamamlandı)';

  -- Aşama değişimi: zaman çizelgesi + bildirim, kendi durum geçmişi
  update public.projects set stage = 'montajda' where id = v_p;
  select count(*) into v_n from public.project_events where project_id = v_p and kind = 'asama';
  if v_n <> 1 then raise exception 'TEST BAŞARISIZ: aşama olayı %', v_n; end if;
  select count(*) into v_n from public.notifications where kind = 'proje_asama' and entity_id = v_p;
  if v_n <> 1 then raise exception 'TEST BAŞARISIZ: aşama bildirimi %', v_n; end if;
  if not exists (select 1 from public.project_status_history where project_id = v_p and from_status = 'uretim' and to_status = 'montaj') then
    raise exception 'TEST BAŞARISIZ: durum geçmişi uretim → montaj yazılmadı';
  end if;
  raise notice 'PASS B: aşama değişimi zaman çizelgesine, bildirime ve durum geçmişine yazıldı';

  -- Aynı güncelleme aşamayı değiştirmezse olay oluşmaz
  update public.projects set notes = 'not' where id = v_p;
  select count(*) into v_n from public.project_events where project_id = v_p and kind = 'asama';
  if v_n <> 1 then raise exception 'TEST BAŞARISIZ: gereksiz aşama olayı'; end if;
  raise notice 'PASS B: aşama değişmeyen güncelleme olay üretmez';

  -- Geçersiz aşama ve ilerleme
  begin
    update public.projects set stage = 'uydurma' where id = v_p;
    raise exception 'TEST BAŞARISIZ: geçersiz aşama kabul edildi';
  exception when check_violation then raise notice 'PASS B: geçersiz aşama reddedilir';
  end;
  begin
    update public.projects set progress = 140 where id = v_p;
    raise exception 'TEST BAŞARISIZ: %%140 ilerleme kabul edildi';
  exception when check_violation then raise notice 'PASS B: ilerleme 0–100 ile sınırlı';
  end;
  begin
    update public.projects set map_url = 'javascript:alert(1)' where id = v_p;
    raise exception 'TEST BAŞARISIZ: güvensiz harita bağlantısı kabul edildi';
  exception when check_violation then raise notice 'PASS B: harita bağlantısı yalnız https';
  end;

  -- Görev: tamamlanma zamanı ve tek olay
  insert into public.project_tasks (project_id, title, due_date) values (v_p, 'Yerinde ölçü alınacak', current_date + 2) returning id into v_t;
  update public.project_tasks set done = true where id = v_t;
  update public.project_tasks set notes = 'x' where id = v_t;
  select count(*) into v_n from public.project_events where ref_id = v_t and kind = 'gorev_tamam';
  if v_n <> 1 or (select done_at from public.project_tasks where id = v_t) is null then raise exception 'TEST BAŞARISIZ: görev tamamlama olayı %', v_n; end if;
  update public.project_tasks set done = false where id = v_t;
  if (select done_at from public.project_tasks where id = v_t) is not null then raise exception 'TEST BAŞARISIZ: geri alınan görevde done_at kaldı'; end if;
  raise notice 'PASS B: görev tamamlanınca bir kez zaman çizelgesine yazılır; geri alınabilir';

  -- Teklif: oluşturma, gönderme, kabul (proje aşaması otomatik DEĞİŞMEZ)
  insert into public.quotes (company_id, project_id, title) values (v_company, v_p, 'Faz7 teklif') returning id into v_q;
  update public.quotes set status = 'gonderildi' where id = v_q;
  update public.quotes set status = 'kabul' where id = v_q;
  select count(*) into v_n from public.project_events where project_id = v_p and kind in ('teklif', 'teklif_gonderildi', 'teklif_kabul');
  if v_n <> 3 then raise exception 'TEST BAŞARISIZ: teklif olayları %', v_n; end if;
  if (select stage from public.projects where id = v_p) <> 'montajda' then raise exception 'TEST BAŞARISIZ: teklif kabulü aşamayı kendiliğinden değiştirdi'; end if;
  select count(*) into v_n from public.notifications where entity_id = v_q and kind in ('teklif_yeni', 'teklif_gonderildi', 'teklif_kabul');
  if v_n <> 3 then raise exception 'TEST BAŞARISIZ: teklif bildirimleri %', v_n; end if;
  raise notice 'PASS B: teklif olayları ve bildirimleri; kabul aşamayı kendiliğinden değiştirmez';

  -- İstemci notifications'a yazamaz, yalnız okundu işaretler
  begin
    insert into public.notifications (user_id, category, kind, title, dedupe_key) values (auth.uid(), 'sistem', 'x', 'Sahte', 'sahte');
    raise exception 'TEST BAŞARISIZ: istemci bildirim ekledi';
  exception when insufficient_privilege then raise notice 'PASS B: istemci doğrudan bildirim ekleyemez';
  end;
  begin
    update public.notifications set title = 'değişti' where entity_id = v_q;
    raise exception 'TEST BAŞARISIZ: bildirim başlığı değişti';
  exception when insufficient_privilege then raise notice 'PASS B: bildirimin yalnız okundu alanı güncellenebilir';
  end;
  update public.notifications set read_at = now() where entity_id = v_q;
  select count(*) into v_n from public.notifications where entity_id = v_q and read_at is not null;
  if v_n <> 3 then raise exception 'TEST BAŞARISIZ: okundu işaretlenmedi'; end if;
  raise notice 'PASS B: okundu işaretleme çalışır';
  begin
    perform public.push_service_claim(10);
    raise exception 'TEST BAŞARISIZ: istemci gönderim işlevini çağırdı';
  exception when insufficient_privilege then raise notice 'PASS B: istemci sunucu gönderim işlevlerini çağıramaz';
  end;
  begin
    perform count(*) from leonx_private.push_config;
    raise exception 'TEST BAŞARISIZ: istemci gizli push yapılandırmasını okudu';
  exception when insufficient_privilege then raise notice 'PASS B: gizli push yapılandırması istemciye kapalı';
  end;
end;
$$;

-- Tercihler: kategori kapalı, kendi işlemlerim kapalı, uygulama içi kapalı
do $$
declare v_n int; v_c uuid;
begin
  insert into public.notification_prefs (cat_proje) values (false);
  insert into public.companies (name) values ('Kategori kapalı') returning id into v_c;
  select count(*) into v_n from public.notifications where entity_id = v_c;
  if v_n <> 0 then raise exception 'TEST BAŞARISIZ: kapalı kategoride bildirim oluştu'; end if;
  update public.notification_prefs set cat_proje = true, own_actions = false;
  insert into public.companies (name) values ('Kendi işlemim') returning id into v_c;
  select count(*) into v_n from public.notifications where entity_id = v_c;
  if v_n <> 0 then raise exception 'TEST BAŞARISIZ: kendi işlemi bildirildi'; end if;
  -- Sistem olayları (sürüm) kendi işlemi sayılmaz
  perform public.notify_client_event('surum_yeni', 'Yeni sürüm hazır', null, '/ayarlar', 'own-off');
  if not exists (select 1 from public.notifications where dedupe_key = 'surum_yeni:own-off') then raise exception 'TEST BAŞARISIZ: sistem bildirimi kendi işlemi sayıldı'; end if;
  update public.notification_prefs set own_actions = true, in_app = false;
  insert into public.companies (name) values ('Uygulama içi kapalı') returning id into v_c;
  select count(*) into v_n from public.notifications where entity_id = v_c;
  if v_n <> 0 then raise exception 'TEST BAŞARISIZ: uygulama içi kapalıyken bildirim'; end if;
  update public.notification_prefs set in_app = true, push = true;
  raise notice 'PASS C: tercihler uygulanıyor (kategori, kendi işlemlerim, uygulama içi)';

  -- Push açık ama abonelik yok → push bekletilmez
  insert into public.companies (name) values ('Aboneliksiz') returning id into v_c;
  if (select push_state from public.notifications where entity_id = v_c) <> 'yok' then raise exception 'TEST BAŞARISIZ: abonelik yokken push bekliyor'; end if;
  -- Abonelik kaydı (aynı uç nokta tekrar kaydedilince tek satır)
  perform public.register_push_subscription('https://push.example.test/abc', repeat('p', 87), repeat('a', 22), 'Test UA', 'iPad');
  perform public.register_push_subscription('https://push.example.test/abc', repeat('q', 87), repeat('b', 22), 'Test UA', null);
  select count(*) into v_n from public.push_subscriptions where endpoint = 'https://push.example.test/abc';
  if v_n <> 1 or (select device_label from public.push_subscriptions where endpoint = 'https://push.example.test/abc') <> 'iPad' then
    raise exception 'TEST BAŞARISIZ: abonelik tekilleşmedi';
  end if;
  insert into public.companies (name) values ('Abonelikli') returning id into v_c;
  if (select push_state from public.notifications where entity_id = v_c) <> 'bekliyor' then raise exception 'TEST BAŞARISIZ: push bekletilmedi'; end if;
  raise notice 'PASS C: push yalnız etkin abonelik varsa bekletilir; abonelik tekrar kaydı tekil';
  begin
    perform public.notify_client_event('uydurma', 'x', null, '/', 'k');
    raise exception 'TEST BAŞARISIZ: geçersiz istemci olayı kabul edildi';
  exception when invalid_parameter_value then raise notice 'PASS C: istemci olay türü sınırlı';
  end;
  perform public.notify_client_event('surum_yeni', 'Yeni sürüm hazır', '1.0', '/ayarlar', 'build-1');
  perform public.notify_client_event('surum_yeni', 'Yeni sürüm hazır', '1.0', '/ayarlar', 'build-1');
  select count(*) into v_n from public.notifications where dedupe_key = 'surum_yeni:build-1';
  if v_n <> 1 then raise exception 'TEST BAŞARISIZ: sürüm bildirimi tekilleşmedi %', v_n; end if;
  raise notice 'PASS C: aynı sürüm bildirimi farklı cihazlardan gelse de tek kayıt';
end;
$$;

-- Hatırlatmalar: tekrar çalıştırma aynı bildirimi üretmez
do $$
declare v_p uuid; v_n int; v_first int; v_second int; v_q uuid; v_c uuid;
begin
  select id into v_p from public.projects where code = 'LX-F7-1';
  update public.notification_prefs set own_actions = false;  -- hatırlatmalar bu tercihten etkilenmemeli
  insert into public.project_tasks (project_id, title, due_date) values (v_p, 'Geciken görev', current_date - 3);
  insert into public.project_tasks (project_id, title, remind_at) values (v_p, 'Hatırlatmalı görev', now() - interval '5 minutes');
  insert into public.project_tasks (project_id, title, due_date, done) values (v_p, 'Tamamlanmış', current_date - 3, true);
  update public.projects set due_date = current_date + 2 where id = v_p;
  select company_id into v_c from public.projects where id = v_p;
  insert into public.quotes (company_id, title, valid_until) values (v_c, 'Süresi biten', current_date + 1) returning id into v_q;
  update public.quotes set status = 'gonderildi' where id = v_q;
  v_first := public.check_reminders();
  v_second := public.check_reminders();
  if v_first < 4 or v_second <> 0 then raise exception 'TEST BAŞARISIZ: hatırlatmalar % / tekrar %', v_first, v_second; end if;
  select count(*) into v_n from public.notifications where kind = 'gorev_gecikti' and title like '%Tamamlanmış%';
  if v_n <> 0 then raise exception 'TEST BAŞARISIZ: tamamlanmış görev gecikmiş sayıldı'; end if;
  select count(*) into v_n from public.notifications where kind in ('gorev_gecikti', 'gorev_hatirlatma', 'teslim_yaklasiyor', 'teklif_suresi');
  if v_n < 4 then raise exception 'TEST BAŞARISIZ: hatırlatma türleri eksik %', v_n; end if;
  raise notice 'PASS D: geciken görev, hatırlatma, teslim ve teklif süresi bildirimleri bir kez oluşur (% adet)', v_first;
end;
$$;
reset role;

-- =====================================================================
-- E) SUNUCU GÖNDERİMİ (service_role)
-- =====================================================================
set local role service_role;
do $$
declare v jsonb; v_id uuid; v_n int; v_cfg jsonb;
begin
  v_cfg := public.push_service_set_keys('BPUBLIC_TEST', 'PRIVATE_TEST');
  v_cfg := public.push_service_set_keys('BBASKA', 'BASKA');
  if v_cfg ->> 'vapid_public' <> 'BPUBLIC_TEST' then raise exception 'TEST BAŞARISIZ: VAPID anahtarı üzerine yazıldı'; end if;
  raise notice 'PASS E: VAPID anahtar çifti yalnız bir kez yazılır';
  v := public.push_service_claim(50);
  if jsonb_array_length(v) < 1 or jsonb_array_length(v -> 0 -> 'subscriptions') <> 1 then raise exception 'TEST BAŞARISIZ: claim %', v; end if;
  if jsonb_array_length(public.push_service_claim(50)) <> 0 then null; end if;
  v_id := (v -> 0 ->> 'id')::uuid;
  perform public.push_service_report(v_id, 0, array['https://push.example.test/abc'], '{}');
  if (select disabled_at from public.push_subscriptions where endpoint = 'https://push.example.test/abc') is null then
    raise exception 'TEST BAŞARISIZ: geçersiz abonelik kapatılmadı';
  end if;
  if (select push_state from public.notifications where id = v_id) <> 'basarisiz' then raise exception 'TEST BAŞARISIZ: push durumu'; end if;
  raise notice 'PASS E: gönderim sahiplenme, sonuç bildirimi, geçersiz abonelik kapatma';
end;
$$;
reset role;

-- =====================================================================
-- F) YETKİSİZ HESAP
-- =====================================================================
set local role authenticated;
select pg_temp.act_as(current_setting('leonx.intruder'));
do $$
declare v_n int;
begin
  select count(*) into v_n from public.notifications;
  if v_n <> 0 then raise exception 'TEST BAŞARISIZ: yetkisiz hesap bildirim gördü'; end if;
  select count(*) into v_n from public.project_tasks;
  if v_n <> 0 then raise exception 'TEST BAŞARISIZ: yetkisiz hesap görev gördü'; end if;
  select count(*) into v_n from public.project_events;
  if v_n <> 0 then raise exception 'TEST BAŞARISIZ: yetkisiz hesap zaman çizelgesi gördü'; end if;
  begin
    perform public.check_reminders();
    raise exception 'TEST BAŞARISIZ: yetkisiz hesap hatırlatma tetikledi';
  exception when insufficient_privilege then raise notice 'PASS F: yetkisiz hesap hatırlatma tetikleyemez';
  end;
  begin
    perform public.register_push_subscription('https://push.example.test/x', repeat('p', 87), repeat('a', 22), null, null);
    raise exception 'TEST BAŞARISIZ: yetkisiz hesap abonelik kaydetti';
  exception when insufficient_privilege then raise notice 'PASS F: yetkisiz hesap push aboneliği kaydedemez';
  end;
  begin
    insert into public.project_tasks (project_id, title) values ((select id from public.projects limit 1), 'Sızma');
    raise exception 'TEST BAŞARISIZ: yetkisiz hesap görev ekledi';
  exception when insufficient_privilege or not_null_violation or check_violation then raise notice 'PASS F: yetkisiz hesap görev ekleyemez';
  end;
  raise notice 'PASS F: yetkisiz hesap hiçbir Faz 7 verisini göremez';
end;
$$;
reset role;

do $$ begin raise notice 'TESTLER BAŞARILI (workflow)'; end $$;
rollback;
