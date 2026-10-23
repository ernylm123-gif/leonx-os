-- =====================================================================
-- LEONX OS — 016: LEONX AI Radar zamanlanmış istihbarat
--   A) Günlük öncelikli rapor ve haftalık hat/takip özeti (radar_reports)
--   B) Önemli değişiklik kaydı (aşama, son tarih, doğrulanmış ihtiyaç, etiket)
--   C) Son tarih hatırlatmaları (7 / 3 / 1 / 0 gün) ve değişiklik bildirimleri
--   D) Sağlık izleme: art arda hata veren kaynak, duran tarama
--   E) Yeni production sürümü bildirimi (version.json, varsayılan KAPALI)
--   F) Fırsattan görev oluşturma
-- 015'e bağlıdır. Tekrar çalıştırılabilir; tablo veya veri silmez. Zamanlayıcılar
-- yalnız pg_cron / pg_net varsa kurulur; sürüm izleme adres girilene kadar istek yapmaz.
-- =====================================================================

-- =====================================================================
-- A) RAPORLAR
-- =====================================================================
create table if not exists public.radar_reports (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('gunluk', 'haftalik')),
  period_start date not null,
  period_end   date not null,
  payload      jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at   timestamptz not null default now(),
  constraint radar_reports_period_unique unique (kind, period_start),
  constraint radar_reports_period_check check (period_end >= period_start)
);
create index if not exists radar_reports_recent_idx on public.radar_reports (created_at desc);

-- =====================================================================
-- B) ÖNEMLİ DEĞİŞİKLİKLER
-- =====================================================================
create table if not exists public.radar_changes (
  id             uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.radar_opportunities (id) on delete cascade,
  field          text not null check (field in ('stage', 'deadline', 'verified_need', 'label')),
  old_value      text check (old_value is null or char_length(old_value) <= 200),
  new_value      text check (new_value is null or char_length(new_value) <= 200),
  created_at     timestamptz not null default now(),
  notified_at    timestamptz
);
create index if not exists radar_changes_opp_idx on public.radar_changes (opportunity_id, created_at desc);
create index if not exists radar_changes_pending_idx on public.radar_changes (created_at) where notified_at is null;

-- Yalnız sunucu (radar_ingest) bu sütunları değiştirebilir; istemci yetkisi yoktur (015 sütun yetkileri).
-- Daha önce bildirilmemiş fırsatlar için kayıt tutulmaz (ilk bildirim zaten güncel hâli gösterir).
create or replace function public.tg_radar_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.notified_at is null then
    return null;
  end if;
  if new.stage is distinct from old.stage then
    insert into public.radar_changes (opportunity_id, field, old_value, new_value) values (new.id, 'stage', old.stage, new.stage);
  end if;
  if new.deadline is distinct from old.deadline then
    insert into public.radar_changes (opportunity_id, field, old_value, new_value)
    values (new.id, 'deadline', to_char(old.deadline, 'DD.MM.YYYY'), to_char(new.deadline, 'DD.MM.YYYY'));
  end if;
  if new.verified_need and not old.verified_need then
    insert into public.radar_changes (opportunity_id, field, old_value, new_value) values (new.id, 'verified_need', 'hayır', 'evet');
  end if;
  if new.label is distinct from old.label then
    insert into public.radar_changes (opportunity_id, field, old_value, new_value) values (new.id, 'label', old.label, new.label);
  end if;
  return null;
end;
$$;
create or replace trigger radar_change_log
  after update of stage, deadline, verified_need, label on public.radar_opportunities
  for each row execute function public.tg_radar_changes();

-- =====================================================================
-- C) RAPOR ÜRETİMİ
--    Günlük: son 24 saatte yeni/güncellenen fırsatlar (Ankara ve puan önceliği),
--            14 gün içinde son tarihi olanlar, kaynak sağlığı.
--    Haftalık: iş akışı durum dağılımı, 7 gündür hareketsiz takipler,
--              hafta içinde kazanılan/kaybedilen, yaklaşan son tarihler.
--    Tekilleştirme: (kind, period_start) benzersiz; bildirim radar:rapor:<tür>:<tarih>.
-- =====================================================================
create or replace function public.radar_build_report(p_kind text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  s        public.radar_settings;
  v_today  date := (now() at time zone 'Europe/Istanbul')::date;
  v_start  date;
  v_end    date;
  v_since  timestamptz;
  v_open   text[] := array['ilgisiz', 'kaybedildi', 'kazanildi'];
  v_pay    jsonb;
  v_id     uuid;
  v_n      integer;
  v_title  text;
begin
  if p_kind not in ('gunluk', 'haftalik') then raise exception 'Geçersiz rapor türü' using errcode = '22023'; end if;
  select * into s from public.radar_settings where singleton;
  if not found then return null; end if;

  if p_kind = 'gunluk' then
    v_start := v_today; v_end := v_today; v_since := now() - interval '24 hours';
    v_pay := jsonb_build_object(
      'generated_at', now(),
      'new_count', (select count(*) from public.radar_opportunities where first_seen_at >= v_since),
      'updated_count', (select count(*) from public.radar_opportunities where last_updated_at >= v_since and first_seen_at < v_since),
      'verified_count', (select count(*) from public.radar_opportunities where first_seen_at >= v_since and verified_need),
      'top', coalesce((
        select jsonb_agg(to_jsonb(t) order by t.is_ankara desc, t.score desc) from (
          select o.id, o.title, o.city, o.district, o.is_ankara, o.score, o.reliability, o.label, o.stage, o.deadline, o.status,
                 (o.first_seen_at >= v_since) as is_new
            from public.radar_opportunities o
           where o.last_updated_at >= v_since and o.status <> all (v_open) and o.score >= s.min_score
           order by o.is_ankara desc, o.score desc
           limit 20) t), '[]'::jsonb),
      'deadlines', coalesce((
        select jsonb_agg(to_jsonb(t) order by t.deadline) from (
          select o.id, o.title, o.city, o.score, o.label, o.deadline, o.status
            from public.radar_opportunities o
           where o.deadline between v_today and v_today + 14 and o.status <> all (v_open)
           order by o.deadline limit 20) t), '[]'::jsonb),
      'sources', jsonb_build_object(
        'active', (select count(*) from public.radar_sources where active and permission_status = 'izinli'),
        'failing', (select count(*) from public.radar_sources where active and consecutive_failures >= 3),
        'runs_24h', (select count(*) from public.radar_source_runs where started_at >= v_since),
        'errors_24h', (select count(*) from public.radar_source_runs where started_at >= v_since and status = 'hata')));
    v_n := (v_pay ->> 'new_count')::integer + (v_pay ->> 'updated_count')::integer;
    v_title := 'LEONX Radar günlük raporu: ' || (v_pay ->> 'new_count') || ' yeni, ' || (v_pay ->> 'updated_count') || ' güncellenen';
  else
    v_start := v_today - 6; v_end := v_today; v_since := now() - interval '7 days';
    v_pay := jsonb_build_object(
      'generated_at', now(),
      'new_count', (select count(*) from public.radar_opportunities where first_seen_at >= v_since),
      'pipeline', coalesce((select jsonb_object_agg(status, n) from (
          select status, count(*) as n from public.radar_opportunities group by status) t), '{}'::jsonb),
      'won', (select count(*) from public.radar_actions where created_at >= v_since and to_status = 'kazanildi'),
      'lost', (select count(*) from public.radar_actions where created_at >= v_since and to_status = 'kaybedildi'),
      'follow_ups', coalesce((
        select jsonb_agg(to_jsonb(t) order by t.score desc) from (
          select o.id, o.title, o.city, o.score, o.status, o.next_action, o.deadline,
                 greatest(o.updated_at, coalesce((select max(a.created_at) from public.radar_actions a where a.opportunity_id = o.id), o.updated_at)) as last_touch
            from public.radar_opportunities o
           where o.status not in ('yeni', 'ilgisiz', 'kaybedildi', 'kazanildi')
             and greatest(o.updated_at, coalesce((select max(a.created_at) from public.radar_actions a where a.opportunity_id = o.id), o.updated_at)) < now() - interval '7 days'
           order by o.score desc limit 30) t), '[]'::jsonb),
      'deadlines', coalesce((
        select jsonb_agg(to_jsonb(t) order by t.deadline) from (
          select o.id, o.title, o.city, o.score, o.label, o.deadline, o.status
            from public.radar_opportunities o
           where o.deadline between v_today and v_today + 21 and o.status <> all (v_open)
           order by o.deadline limit 30) t), '[]'::jsonb));
    v_n := (v_pay ->> 'new_count')::integer + jsonb_array_length(v_pay -> 'follow_ups') + jsonb_array_length(v_pay -> 'deadlines');
    v_title := 'LEONX Radar haftalık özeti: ' || (v_pay ->> 'new_count') || ' yeni fırsat, '
      || jsonb_array_length(v_pay -> 'follow_ups') || ' takip bekliyor';
  end if;

  insert into public.radar_reports (kind, period_start, period_end, payload)
  values (p_kind, v_start, v_end, v_pay)
  on conflict (kind, period_start) do update set payload = excluded.payload, period_end = excluded.period_end, created_at = now()
  returning id into v_id;

  if v_n > 0 then
    perform public.leonx_notify('firsat', 'radar_rapor', v_title, 'Rapor LEONX AI › Raporlar bölümünde',
      '/leonx-ai?bolum=raporlar', null, null, 'radar:rapor:' || p_kind || ':' || v_start, true);
  end if;
  return v_id;
end;
$$;

-- =====================================================================
-- C2) SON TARİH HATIRLATMALARI VE DEĞİŞİKLİK BİLDİRİMLERİ
--     Hatırlatma yalnız takip edilen (durumu "yeni" dışında) veya doğrulanmış ihtiyaçlı açık fırsatlar için.
--     Değişiklik bildirimi yalnız puan eşiğini geçen açık fırsatlar için; sessiz saatlerde bekletilir.
-- =====================================================================
create or replace function public.radar_notify_updates()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s       public.radar_settings;
  r       record;
  v_hour  integer := extract(hour from (now() at time zone 'Europe/Istanbul'))::integer;
  v_today date := (now() at time zone 'Europe/Istanbul')::date;
  v_quiet boolean;
  v_days  integer;
  v_text  text;
  v_n     integer := 0;
begin
  select * into s from public.radar_settings where singleton;
  if not found then return 0; end if;
  v_quiet := s.quiet_start is not null and s.quiet_end is not null and s.quiet_start <> s.quiet_end and (
    case when s.quiet_start < s.quiet_end then v_hour >= s.quiet_start and v_hour < s.quiet_end
         else v_hour >= s.quiet_start or v_hour < s.quiet_end end);

  -- Son tarih (dedupe: radar:son:<id>:<gün>; aynı eşik ikinci kez bildirilmez)
  if not v_quiet or s.critical_enabled then
    for r in
      select o.id, o.title, o.city, o.deadline, o.score from public.radar_opportunities o
       where o.deadline is not null and o.deadline - v_today in (7, 3, 1, 0)
         and o.status not in ('ilgisiz', 'kaybedildi', 'kazanildi', 'teklif_verildi')
         and (o.verified_need or o.status <> 'yeni')
    loop
      v_days := r.deadline - v_today;
      perform public.leonx_notify('firsat', 'radar_son_tarih',
        case when v_days = 0 then 'Son teklif günü bugün: ' else 'Son tarihe ' || v_days || ' gün: ' end || r.title,
        coalesce(r.city || ' · ', '') || 'Puan ' || r.score || ' · son tarih ' || to_char(r.deadline, 'DD.MM.YYYY'),
        '/leonx-ai/firsat/' || r.id, 'radar_opportunity', r.id, 'radar:son:' || r.id || ':' || v_days, true);
      v_n := v_n + 1;
    end loop;
  end if;

  if v_quiet then
    return v_n;
  end if;

  -- Değişiklikler: fırsat başına tek bildirim (birden çok alan birleştirilir)
  for r in
    select c.opportunity_id, o.title, o.score, o.status,
           string_agg(case c.field
             when 'stage' then 'aşama ' || coalesce(c.old_value, '—') || ' → ' || coalesce(c.new_value, '—')
             when 'deadline' then 'son tarih ' || coalesce(c.old_value, '—') || ' → ' || coalesce(c.new_value, '—')
             when 'verified_need' then 'ihtiyaç kaynakla doğrulandı'
             else 'etiket ' || coalesce(c.old_value, '—') || ' → ' || coalesce(c.new_value, '—') end, ' · ' order by c.created_at) as summary,
           max(c.created_at) as last_at
      from public.radar_changes c join public.radar_opportunities o on o.id = c.opportunity_id
     where c.notified_at is null
     group by c.opportunity_id, o.title, o.score, o.status
     limit 50
  loop
    if r.score >= s.min_score and r.status not in ('ilgisiz', 'kaybedildi', 'kazanildi') then
      v_text := left(r.summary, 400);
      perform public.leonx_notify('firsat', 'radar_degisiklik', 'Fırsat güncellendi: ' || r.title, v_text,
        '/leonx-ai/firsat/' || r.opportunity_id, 'radar_opportunity', r.opportunity_id,
        'radar:degisim:' || r.opportunity_id || ':' || to_char(r.last_at at time zone 'UTC', 'YYYYMMDDHH24MISS'), true);
      v_n := v_n + 1;
    end if;
    update public.radar_changes set notified_at = now() where opportunity_id = r.opportunity_id and notified_at is null and created_at <= r.last_at;
  end loop;
  return v_n;
end;
$$;

-- =====================================================================
-- D) SAĞLIK İZLEME
-- =====================================================================
create or replace function public.radar_health_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'checked_at', now(),
    'scan_configured', (select scan_url is not null from leonx_private.radar_config where singleton),
    'active_sources', (select count(*) from public.radar_sources where active and permission_status = 'izinli'),
    'failing_sources', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'failures', consecutive_failures,
                          'last_status', last_status)) from public.radar_sources where active and consecutive_failures >= 3), '[]'::jsonb),
    'last_run_at', (select max(started_at) from public.radar_source_runs),
    'runs_24h', (select count(*) from public.radar_source_runs where started_at > now() - interval '24 hours'),
    'errors_24h', (select count(*) from public.radar_source_runs where started_at > now() - interval '24 hours' and status = 'hata'),
    'pending_notifications', (select count(*) from public.radar_opportunities where notified_at is null and first_seen_at > now() - interval '14 days'));
$$;

-- Sahip arayüzü için (yalnız is_owner)
create or replace function public.radar_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then raise exception 'Yetkisiz' using errcode = '42501'; end if;
  return public.radar_health_snapshot();
end;
$$;

create or replace function public.radar_health_check()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  h       jsonb := public.radar_health_snapshot();
  v_today date := (now() at time zone 'Europe/Istanbul')::date;
  f       jsonb;
  v_n     integer := 0;
begin
  for f in select * from jsonb_array_elements(h -> 'failing_sources') loop
    perform public.leonx_notify('sistem', 'radar_saglik', 'Radar kaynağı art arda hata veriyor: ' || (f ->> 'name'),
      (f ->> 'failures') || ' ardışık hata; tarama geri çekilmeyle yeniden denenecek. Kaynağı LEONX AI › Kaynaklar bölümünde test edin.',
      '/leonx-ai?bolum=kaynaklar', null, null, 'radar:saglik:kaynak:' || (f ->> 'id') || ':' || v_today, true);
    v_n := v_n + 1;
  end loop;
  -- Tarama yapılandırılmış, izinli kaynak var ama 3 saattir hiç çalıştırma kaydı yok → zamanlayıcı/işlev durmuş olabilir
  if coalesce((h ->> 'scan_configured')::boolean, false) and (h ->> 'active_sources')::integer > 0
     and coalesce((h ->> 'last_run_at')::timestamptz, '-infinity'::timestamptz) < now() - interval '3 hours' then
    perform public.leonx_notify('sistem', 'radar_saglik', 'Radar taraması durmuş görünüyor',
      'Son 3 saatte tarama kaydı yok. radar-scan işlevinin günlüklerini ve zamanlayıcıyı kontrol edin.',
      '/leonx-ai?bolum=kaynaklar', null, null, 'radar:saglik:tarama:' || v_today, true);
    v_n := v_n + 1;
  end if;
  return v_n;
end;
$$;

-- =====================================================================
-- E) YENİ PRODUCTION SÜRÜMÜ BİLDİRİMİ
--    İki adımlı pg_net yoklaması: önceki isteğin yanıtı okunur, yeni istek atılır.
--    Yalnız env = "production" derlemeleri bildirilir; ilk okuma yalnız temel alınır.
--    Varsayılan KAPALI: version_url boşken hiçbir istek yapılmaz.
-- =====================================================================
create table if not exists leonx_private.release_watch (
  singleton      boolean primary key default true check (singleton),
  version_url    text check (version_url is null or version_url ~ '^https://[^/]+/version\.json$'),
  last_build_id  text,
  last_version   text,
  pending_id     bigint,
  checked_at     timestamptz,
  last_error     text
);
revoke all on table leonx_private.release_watch from public, anon, authenticated;
insert into leonx_private.release_watch (singleton) values (true) on conflict (singleton) do nothing;

create or replace function leonx_private.check_release()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  w        leonx_private.release_watch;
  v_status integer;
  v_body   text;
  v_json   jsonb;
  v_id     bigint;
begin
  select * into w from leonx_private.release_watch where singleton for update;
  if not found or w.version_url is null then
    return;
  end if;
  if w.pending_id is not null and to_regclass('net._http_response') is not null then
    execute 'select status_code, content from net._http_response where id = $1' into v_status, v_body using w.pending_id;
    if v_status = 200 then
      begin
        v_json := v_body::jsonb;
      exception when others then
        v_json := null;
      end;
      if v_json is not null and v_json ->> 'env' = 'production' and coalesce(v_json ->> 'buildId', '') <> ''
         and v_json ->> 'buildId' is distinct from w.last_build_id then
        if w.last_build_id is not null then
          -- İstemcinin notify_client_event('surum_yeni', …, buildId) çağrısıyla aynı tür ve tekilleştirme anahtarı:
          -- sürümü hangisi önce görürse görsün tek bildirim oluşur.
          perform public.leonx_notify('sistem', 'surum_yeni', 'Yeni LEONX OS sürümü hazır',
            left('Sürüm ' || coalesce(v_json ->> 'version', '?') || ' · ' || coalesce(v_json ->> 'commit', '?'), 500),
            '/ayarlar', null, null, 'surum_yeni:' || left(v_json ->> 'buildId', 150), true);
        end if;
        update leonx_private.release_watch
           set last_build_id = v_json ->> 'buildId', last_version = left(v_json ->> 'version', 20), last_error = null
         where singleton;
      elsif v_json is null then
        update leonx_private.release_watch set last_error = 'version.json okunamadı' where singleton;
      end if;
    elsif v_status is not null then
      update leonx_private.release_watch set last_error = 'HTTP ' || v_status where singleton;
    end if;
  end if;
  if to_regprocedure('net.http_get(text,jsonb,jsonb,integer)') is null then
    return;
  end if;
  execute 'select net.http_get(url := $1, params := $2, headers := $3, timeout_milliseconds := 10000)'
    into v_id using w.version_url, jsonb_build_object('t', extract(epoch from now())::bigint::text), '{"Cache-Control":"no-cache"}'::jsonb;
  update leonx_private.release_watch set pending_id = v_id, checked_at = now() where singleton;
end;
$$;
revoke all on function leonx_private.check_release() from public;

-- =====================================================================
-- F) FIRSATTAN GÖREV
--    Proje adayı yoksa radar_import_to_crm ile (tekrarlanabilir) oluşturulur.
-- =====================================================================
create or replace function public.radar_create_task(p_opportunity uuid, p_title text, p_due date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_opp     public.radar_opportunities;
  v_project uuid;
  v_task    uuid;
  v_title   text := btrim(coalesce(p_title, ''));
begin
  if not public.is_owner() then raise exception 'Yetkisiz' using errcode = '42501'; end if;
  if char_length(v_title) not between 1 and 200 then raise exception 'Görev başlığı 1–200 karakter olmalı' using errcode = '22023'; end if;
  select * into v_opp from public.radar_opportunities where id = p_opportunity;
  if not found then raise exception 'Fırsat bulunamadı' using errcode = 'P0002'; end if;
  v_project := v_opp.project_id;
  if v_project is null or not exists (select 1 from public.projects where id = v_project) then
    v_project := (public.radar_import_to_crm(p_opportunity, null, true) ->> 'project_id')::uuid;
  end if;
  insert into public.project_tasks (project_id, title, description, priority, due_date)
  values (v_project, v_title,
          left('LEONX Radar fırsatı: ' || v_opp.title || E'\n/leonx-ai/firsat/' || v_opp.id
               || coalesce(E'\nSon tarih: ' || to_char(v_opp.deadline, 'DD.MM.YYYY'), ''), 5000),
          case when v_opp.deadline is not null and v_opp.deadline <= current_date + 7 then 'acil'
               when v_opp.verified_need then 'yuksek' else 'normal' end,
          coalesce(p_due, case when v_opp.deadline is not null and v_opp.deadline >= current_date then v_opp.deadline end))
  returning id into v_task;
  return jsonb_build_object('project_id', v_project, 'task_id', v_task);
end;
$$;

-- =====================================================================
-- G) YETKİLER, RLS, REALTIME
-- =====================================================================
revoke all on function public.tg_radar_changes() from public, anon, authenticated;
revoke all on function public.radar_build_report(text) from public, anon, authenticated;
revoke all on function public.radar_notify_updates() from public, anon, authenticated;
revoke all on function public.radar_health_snapshot() from public, anon, authenticated;
revoke all on function public.radar_health_check() from public, anon, authenticated;
revoke all on function public.radar_health() from public, anon;
revoke all on function public.radar_create_task(uuid, text, date) from public, anon;
grant execute on function public.radar_health() to authenticated;
grant execute on function public.radar_create_task(uuid, text, date) to authenticated;

revoke all on table public.radar_reports, public.radar_changes from anon, authenticated;
grant select on table public.radar_reports, public.radar_changes to authenticated;
alter table public.radar_reports enable row level security;
alter table public.radar_changes enable row level security;
do $$
declare
  t text;
begin
  foreach t in array array['radar_reports', 'radar_changes'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'owner_read') then
      execute format('create policy owner_read on public.%I for select to authenticated using (public.is_owner())', t);
    end if;
  end loop;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['radar_reports', 'radar_changes'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;

-- =====================================================================
-- H) ZAMANLAYICI (saatler UTC; Türkiye = UTC+3)
--    leonx-radar-gunluk   07:30 TR  günlük rapor
--    leonx-radar-haftalik Pazartesi 08:00 TR  haftalık özet
--    leonx-radar-guncelleme her saat :35  son tarih + değişiklik bildirimleri
--    leonx-radar-saglik   her saat :50  sağlık denetimi
--    leonx-surum          10 dakikada bir sürüm yoklaması (adres boşken istek yok)
-- =====================================================================
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net') then
    raise notice 'pg_cron / pg_net bulunamadı; radar istihbarat zamanlayıcısı kurulmadı.';
    return;
  end if;
  execute 'create schema if not exists extensions';
  execute 'create extension if not exists pg_net with schema extensions';
  execute 'create extension if not exists pg_cron';
  execute $q$select cron.schedule('leonx-radar-gunluk', '30 4 * * *', $c$select public.radar_build_report('gunluk')$c$)$q$;
  execute $q$select cron.schedule('leonx-radar-haftalik', '0 5 * * 1', $c$select public.radar_build_report('haftalik')$c$)$q$;
  execute $q$select cron.schedule('leonx-radar-guncelleme', '35 * * * *', 'select public.radar_notify_updates()')$q$;
  execute $q$select cron.schedule('leonx-radar-saglik', '50 * * * *', 'select public.radar_health_check()')$q$;
  execute $q$select cron.schedule('leonx-surum', '*/10 * * * *', 'select leonx_private.check_release()')$q$;
end;
$$;
