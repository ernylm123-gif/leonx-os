-- =====================================================================
-- LEONX OS — 018: AI Radar üretim hattı işletimi
--   A) Kaynak doğrulama kaydı; doğrulanmamış otomatik kaynak "İzinli" yapılamaz (veritabanı kuralı)
--   B) Çalıştırma kaydında reddedilen öğe sayısı ve nedenleri (ilgililik kapısı, radar-scan)
--   C) Zamanlayıcı çağrısının son HTTP yanıtı (radar-scan'e ulaşıldı mı?) izlenir
--   D) İşletim paneli özeti: radar_ops() — panel sayıları doğrudan veritabanından hesaplanır
--   E) Günlük rapor: fırsat çıkmasa da üretilir ve sıfır dürüstçe bildirilir (tarama sayılarıyla)
-- 015–017'ye bağlıdır. Tekrar çalıştırılabilir; tablo veya veri silmez.
-- =====================================================================

-- =====================================================================
-- A) KAYNAK DOĞRULAMA
--   verification: radar-scan "verify" çıktısı { ok, checked_at, robots, http_status, items, sample, blockers[] … }
--   verified_at:  son BAŞARILI doğrulama zamanı
--   Kural: rss/atom/site kaynağı yalnız son 30 gün içinde başarıyla doğrulandıysa 'izinli' olabilir.
-- =====================================================================
alter table public.radar_sources add column if not exists verification jsonb;
alter table public.radar_sources add column if not exists verified_at timestamptz;

create or replace function public.tg_radar_source_permission()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Doğrulama alanlarını yalnız sunucu (radar_service_save_verification) yazar; istemciden gelen değer yok sayılır
  if current_user not in ('postgres', 'service_role', 'supabase_admin') then
    if tg_op = 'INSERT' then
      new.verification := null;
      new.verified_at := null;
    else
      new.verification := old.verification;
      new.verified_at := old.verified_at;
    end if;
  end if;
  -- Adres/tür/izinli makineler değişirse eski doğrulama geçersizdir: kaynak yeniden doğrulanana dek kapanır
  if tg_op = 'UPDATE' and (new.url, new.kind, new.allowed_hosts) is distinct from (old.url, old.kind, old.allowed_hosts) then
    new.verification := null;
    new.verified_at := null;
    if new.permission_status = 'izinli' and new.kind in ('rss', 'atom', 'site') then
      new.permission_status := 'inceleniyor';
      new.active := false;
    end if;
  end if;
  if new.permission_status = 'izinli' and new.kind in ('rss', 'atom', 'site')
     and (tg_op = 'INSERT' or old.permission_status is distinct from 'izinli') then
    if coalesce((new.verification ->> 'ok')::boolean, false) is not true
       or new.verified_at is null or new.verified_at < now() - interval '30 days' then
      raise exception 'Kaynak doğrulanmadan İzinli yapılamaz: önce "Doğrula" çalıştırın (robots.txt, erişim, ilan çıkarımı)'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
create or replace trigger radar_source_permission
  before insert or update on public.radar_sources
  for each row execute function public.tg_radar_source_permission();

-- Doğrulama sonucunu yazar (yalnız service_role — radar-scan sahip/zamanlayıcı kimliğini doğruladıktan sonra).
-- Başarısız doğrulama, izinli bir kaynağı "İnceleniyor + pasif" durumuna düşürür.
create or replace function public.radar_service_save_verification(p_source uuid, p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ok  boolean := coalesce((p_result ->> 'ok')::boolean, false);
  v_src public.radar_sources;
begin
  if jsonb_typeof(p_result) <> 'object' or octet_length(p_result::text) > 20000 then
    raise exception 'Geçersiz doğrulama sonucu' using errcode = '22023';
  end if;
  update public.radar_sources set
    verification = p_result || jsonb_build_object('checked_at', now()),
    verified_at = case when v_ok then now() else verified_at end,
    permission_checked_at = now(),
    permission_status = case when not v_ok and permission_status = 'izinli' then 'inceleniyor' else permission_status end,
    active = case when not v_ok and permission_status = 'izinli' then false else active end
  where id = p_source
  returning * into v_src;
  if not found then raise exception 'Kaynak bulunamadı' using errcode = 'P0002'; end if;
  return jsonb_build_object('ok', v_ok, 'permission_status', v_src.permission_status, 'active', v_src.active);
end;
$$;

-- =====================================================================
-- B) REDDEDİLEN ÖĞELER
-- =====================================================================
alter table public.radar_source_runs add column if not exists items_rejected integer not null default 0;
alter table public.radar_source_runs add column if not exists reject_reasons jsonb not null default '{}'::jsonb;

create or replace function public.radar_service_record_rejects(p_run uuid, p_rejected integer, p_reasons jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_merged jsonb := '{}'::jsonb;
  k text;
  v text;
begin
  if p_rejected is null or p_rejected < 0 or p_rejected > 10000 then raise exception 'Geçersiz sayı' using errcode = '22023'; end if;
  select coalesce(reject_reasons, '{}'::jsonb) into v_merged from public.radar_source_runs where id = p_run for update;
  if not found then raise exception 'Çalıştırma bulunamadı' using errcode = 'P0002'; end if;
  for k, v in select * from jsonb_each_text(coalesce(p_reasons, '{}'::jsonb)) loop
    if k !~ '^[a-z_]{1,40}$' or v !~ '^\d{1,6}$' then continue; end if;
    v_merged := v_merged || jsonb_build_object(k, coalesce((v_merged ->> k)::integer, 0) + v::integer);
  end loop;
  update public.radar_source_runs set items_rejected = items_rejected + p_rejected, reject_reasons = v_merged where id = p_run;
end;
$$;

-- =====================================================================
-- C) ZAMANLAYICI ÇAĞRISININ İZİ
-- =====================================================================
alter table leonx_private.radar_config add column if not exists last_request_id bigint;
alter table leonx_private.radar_config add column if not exists last_dispatch_at timestamptz;

create or replace function leonx_private.dispatch_radar()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
  v_id     bigint;
begin
  select scan_url into v_url from leonx_private.radar_config where singleton;
  if v_url is null then
    return;
  end if;
  select cron_secret into v_secret from leonx_private.push_config where singleton;
  if v_secret is null then
    return;
  end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 55000)'
  into v_id
  using v_url, '{}'::jsonb, jsonb_build_object('Content-Type', 'application/json', 'x-leonx-cron', v_secret);
  update leonx_private.radar_config set last_request_id = v_id, last_dispatch_at = now() where singleton;
end;
$$;
revoke all on function leonx_private.dispatch_radar() from public;

-- =====================================================================
-- D) İŞLETİM ÖZETİ (panel sayıları = veritabanı değerleri)
-- =====================================================================
create or replace function public.radar_ops_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg    leonx_private.radar_config;
  v_since  timestamptz := now() - interval '24 hours';
  v_next   timestamptz;
  v_cron   boolean := false;
  v_http   jsonb;
  v_push   jsonb;
  v_reasons jsonb;
begin
  select * into v_cfg from leonx_private.radar_config where singleton;
  -- Saatlik iş: "17 * * * *" (UTC). Bir sonraki çalışma saatin 17. dakikası.
  -- pg_cron / pg_net yoksa (yerel test) ilgili alanlar boş kalır
  if to_regclass('cron.job') is not null then
    execute 'select coalesce(bool_or(active), false) from cron.job where jobname = $1' into v_cron using 'leonx-radar';
  end if;
  v_next := date_trunc('hour', now()) + interval '17 minutes';
  if v_next <= now() then v_next := v_next + interval '1 hour'; end if;

  if v_cfg.last_request_id is not null and to_regclass('net._http_response') is not null then
    execute $q$select jsonb_build_object('status_code', r.status_code, 'error', left(r.error_msg, 300), 'at', r.created,
             'body', left(case when r.status_code between 200 and 299 then null else r.content end, 300))
      from net._http_response r where r.id = $1$q$ into v_http using v_cfg.last_request_id;
  end if;

  select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) into v_reasons from (
    select e.key as k, sum(e.value::integer) as n
      from public.radar_source_runs r, jsonb_each_text(r.reject_reasons) e
     where r.started_at >= v_since group by e.key) t;

  select jsonb_build_object(
      'subscriptions', (select count(*) from public.push_subscriptions where disabled_at is null),
      'last_success_at', (select max(last_success_at) from public.push_subscriptions),
      'last', (select to_jsonb(t) from (
                 select n.title, n.kind, n.push_state, n.push_attempts, n.created_at
                   from public.notifications n where n.push_state <> 'yok' order by n.created_at desc limit 1) t),
      'pending', (select count(*) from public.notifications where push_state = 'bekliyor'),
      'failed', (select count(*) from public.notifications where push_state = 'basarisiz' and created_at >= now() - interval '7 days'))
    into v_push;

  return jsonb_build_object(
    'checked_at', now(),
    'scan_configured', v_cfg.scan_url is not null,
    'cron_active', v_cron,
    'next_scan_at', case when v_cron and v_cfg.scan_url is not null then v_next end,
    'last_dispatch_at', v_cfg.last_dispatch_at,
    'last_dispatch_http', v_http,
    'active_sources', (select count(*) from public.radar_sources where active and permission_status = 'izinli' and kind <> 'manual'),
    'verified_sources', (select count(*) from public.radar_sources where kind <> 'manual' and coalesce((verification ->> 'ok')::boolean, false) and verified_at >= now() - interval '30 days'),
    'candidate_sources', (select count(*) from public.radar_sources where kind <> 'manual' and permission_status <> 'izinli'),
    'last_success_at', (select max(finished_at) from public.radar_source_runs where status in ('ok', 'degismedi')),
    'last_run_at', (select max(started_at) from public.radar_source_runs),
    'sources_checked_24h', (select count(distinct source_id) from public.radar_source_runs where started_at >= v_since),
    'runs_24h', (select count(*) from public.radar_source_runs where started_at >= v_since),
    'errors_24h', (select count(*) from public.radar_source_runs where started_at >= v_since and status = 'hata'),
    -- radar_items.items_seen = yazılan (ilgili) öğe; toplanan = yazılan + reddedilen
    'items_collected_24h', (select coalesce(sum(items_seen + items_rejected), 0) from public.radar_source_runs where started_at >= v_since),
    'items_rejected_24h', (select coalesce(sum(items_rejected), 0) from public.radar_source_runs where started_at >= v_since),
    'reject_reasons_24h', v_reasons,
    'opportunities_new_24h', (select count(*) from public.radar_opportunities where first_seen_at >= v_since),
    'opportunities_verified_24h', (select count(*) from public.radar_opportunities where first_seen_at >= v_since and verified_need),
    'opportunities_total', (select count(*) from public.radar_opportunities),
    'push', v_push,
    'errors', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.at desc) from (
        select s.id as source_id, s.name, r.status, r.http_status, left(r.error, 300) as error, r.started_at as at, s.consecutive_failures as failures
          from public.radar_source_runs r join public.radar_sources s on s.id = r.source_id
         where r.started_at >= now() - interval '72 hours' and r.status in ('hata', 'atlandi')
         order by r.started_at desc limit 10) t), '[]'::jsonb));
end;
$$;

create or replace function public.radar_ops()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then raise exception 'Yetkisiz' using errcode = '42501'; end if;
  return public.radar_ops_snapshot();
end;
$$;

-- =====================================================================
-- E) GÜNLÜK RAPOR: her gün üretilir ve bildirilir (sıfır dahil); tarama sayıları rapora eklenir
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
  v_body   text;
  v_ops    jsonb;
begin
  if p_kind not in ('gunluk', 'haftalik') then raise exception 'Geçersiz rapor türü' using errcode = '22023'; end if;
  select * into s from public.radar_settings where singleton;
  if not found then return null; end if;

  if p_kind = 'gunluk' then
    v_start := v_today; v_end := v_today; v_since := now() - interval '24 hours';
    v_ops := public.radar_ops_snapshot();
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
        'active', (v_ops ->> 'active_sources')::integer,
        'failing', (select count(*) from public.radar_sources where active and consecutive_failures >= 3),
        'runs_24h', (v_ops ->> 'runs_24h')::integer,
        'errors_24h', (v_ops ->> 'errors_24h')::integer,
        'checked_24h', (v_ops ->> 'sources_checked_24h')::integer,
        'items_collected_24h', (v_ops ->> 'items_collected_24h')::integer,
        'items_rejected_24h', (v_ops ->> 'items_rejected_24h')::integer,
        'reject_reasons_24h', v_ops -> 'reject_reasons_24h'));
    v_title := 'LEONX Radar günlük satış raporu: ' || (v_pay ->> 'new_count') || ' yeni fırsat ('
      || (v_pay ->> 'verified_count') || ' doğrulanmış)';
    v_body := (v_ops ->> 'sources_checked_24h') || ' kaynak tarandı, ' || (v_ops ->> 'items_collected_24h') || ' ilan okundu, '
      || (v_ops ->> 'items_rejected_24h') || ' ilgisiz elendi'
      || case when (v_ops ->> 'active_sources')::integer = 0 then '. UYARI: izinli ve etkin kaynak yok — tarama yapılmıyor.'
              when (v_pay ->> 'new_count')::integer = 0 then '. Bugün uygun fırsat bulunamadı.' else '.' end;
    -- Günlük rapor her gün bildirilir: sıfır sonuç da bilgidir (yanıltıcı "başarılı" mesajı yerine)
    v_n := 1;
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
    v_body := 'Rapor LEONX AI › Raporlar bölümünde';
  end if;

  insert into public.radar_reports (kind, period_start, period_end, payload)
  values (p_kind, v_start, v_end, v_pay)
  on conflict (kind, period_start) do update set payload = excluded.payload, period_end = excluded.period_end, created_at = now()
  returning id into v_id;

  if v_n > 0 then
    perform public.leonx_notify('firsat', 'radar_rapor', v_title, v_body,
      '/leonx-ai?bolum=raporlar', null, null, 'radar:rapor:' || p_kind || ':' || v_start, true);
  end if;
  return v_id;
end;
$$;

-- =====================================================================
-- F) YETKİLER
-- =====================================================================
revoke all on function public.tg_radar_source_permission() from public, anon, authenticated;
revoke all on function public.radar_build_report(text) from public, anon, authenticated;
revoke all on function public.radar_ops_snapshot() from public, anon, authenticated;
revoke all on function public.radar_ops() from public, anon;
grant execute on function public.radar_ops() to authenticated;
do $$
declare
  f text;
begin
  foreach f in array array['public.radar_service_save_verification(uuid, jsonb)', 'public.radar_service_record_rejects(uuid, integer, jsonb)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end;
$$;
