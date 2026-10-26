-- =====================================================================
-- LEONX OS — 017: LEONX AI Radar yayın hazırlığı
--   A) Yalnız şifre ile giriş için kaba kuvvet koruması (owner-login Edge Function)
--   B) İletişim kanalı sonradan bulunduğunda fırsat puanının iletişim etkeni yeniden hesaplanır
--   C) Fırsattan teklif taslağı: fırsat başına tek teklif (veritabanı düzeyinde tekrar önleme)
--   D) Tek kullanımlık, kısa ömürlü cihaz kayıt kodu ve yetkili cihazlar (hatırlama, iptal)
-- 015 ve 016'ya bağlıdır. Tekrar çalıştırılabilir; tablo veya veri silmez (yalnız süresi geçmiş
-- giriş denemesi sayaçları temizlenir). Şifre veya e-posta veritabanında SAKLANMAZ.
-- =====================================================================

-- =====================================================================
-- A) GİRİŞ DENEMESİ SAYAÇLARI
--   bucket: 'ip:<sha256>' (IP adresi açık metin olarak tutulmaz) veya 'global'
--   IP başına: 15 dakikalık pencerede 5 hatadan sonra kilit 30 sn × 2^(hata−5), en çok 1 saat.
--   Genel: 15 dakikada 50 hata → 5 dakika tüm girişler beklemeye alınır (dağıtık deneme).
-- =====================================================================
create table if not exists leonx_private.owner_login_attempts (
  bucket       text primary key check (bucket = 'global' or bucket ~ '^ip:[0-9a-f]{64}$'),
  failures     integer not null default 0 check (failures >= 0),
  window_start timestamptz not null default now(),
  locked_until timestamptz,
  updated_at   timestamptz not null default now()
);
revoke all on table leonx_private.owner_login_attempts from public, anon, authenticated;

-- Beklenmesi gereken saniye (0 = deneme yapılabilir)
create or replace function public.owner_login_check(p_ip_hash text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wait numeric;
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Geçersiz istemci anahtarı' using errcode = '22023';
  end if;
  select max(extract(epoch from (a.locked_until - now())))
    into v_wait
    from leonx_private.owner_login_attempts a
   where a.bucket in ('ip:' || p_ip_hash, 'global')
     and a.locked_until > now();
  return greatest(0, ceil(coalesce(v_wait, 0)))::integer;
end;
$$;

-- Deneme sonucunu kaydeder; yeni bekleme süresini döner
create or replace function public.owner_login_record(p_ip_hash text, p_success boolean)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window constant interval := interval '15 minutes';
  v_ip text;
  v_fail integer;
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' or p_success is null then
    raise exception 'Geçersiz deneme kaydı' using errcode = '22023';
  end if;
  v_ip := 'ip:' || p_ip_hash;

  -- Eski sayaçlar (1 günden eski, kilitsiz) temizlenir; tablo büyümez
  delete from leonx_private.owner_login_attempts
   where bucket <> 'global' and updated_at < now() - interval '1 day' and (locked_until is null or locked_until < now());

  if p_success then
    delete from leonx_private.owner_login_attempts where bucket = v_ip;
    return 0;
  end if;

  insert into leonx_private.owner_login_attempts as a (bucket, failures, window_start, updated_at)
  values (v_ip, 1, now(), now())
  on conflict (bucket) do update
    set failures = case when a.window_start < now() - v_window and (a.locked_until is null or a.locked_until < now()) then 1 else a.failures + 1 end,
        window_start = case when a.window_start < now() - v_window and (a.locked_until is null or a.locked_until < now()) then now() else a.window_start end,
        updated_at = now()
  returning failures into v_fail;
  if v_fail >= 5 then
    update leonx_private.owner_login_attempts
       set locked_until = now() + make_interval(secs => least(3600, 30 * power(2, least(v_fail - 5, 12))))
     where bucket = v_ip;
  end if;

  insert into leonx_private.owner_login_attempts as a (bucket, failures, window_start, updated_at)
  values ('global', 1, now(), now())
  on conflict (bucket) do update
    set failures = case when a.window_start < now() - v_window then 1 else a.failures + 1 end,
        window_start = case when a.window_start < now() - v_window then now() else a.window_start end,
        updated_at = now()
  returning failures into v_fail;
  if v_fail >= 50 then
    update leonx_private.owner_login_attempts
       set locked_until = greatest(coalesce(locked_until, now()), now() + interval '5 minutes')
     where bucket = 'global';
  end if;

  return public.owner_login_check(p_ip_hash);
end;
$$;

revoke all on function public.owner_login_check(text) from public, anon, authenticated;
revoke all on function public.owner_login_record(text, boolean) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.owner_login_check(text) to service_role';
    execute 'grant execute on function public.owner_login_record(text, boolean) to service_role';
    execute 'grant usage on schema leonx_private to service_role';
    -- owner-login: OWNER_EMAIL tanımlı değilse sahip kimliği buradan okunur (yalnız okuma, yalnız sunucu)
    execute 'grant select on public.app_owner to service_role';
  end if;
end;
$$;

-- =====================================================================
-- B) İLETİŞİM ETKENİNİN YENİDEN HESAPLANMASI
--   score.ts ile aynı kural: tedarikçi portalı / ihale adresi / satın alma e-postası → 1,
--   başka doğrulanmış kanal → 0.7, yoksa sınıflandırmadan gelen taban değer (base_factor).
--   Kanal silinirse puan taban değere döner. Toplam puan = Σ points (0–100).
-- =====================================================================
create or replace function public.radar_rescore_breakdown(p_breakdown jsonb, p_strong integer, p_any integer, out breakdown jsonb, out score integer)
language plpgsql
immutable
set search_path = ''
as $$
declare
  e jsonb;
  v_out jsonb := '[]'::jsonb;
  v_base_f numeric;
  v_base_r text;
  v_f numeric;
  v_r text;
  v_w numeric;
  v_sum numeric := 0;
begin
  if p_breakdown is null or jsonb_typeof(p_breakdown) <> 'array' then
    breakdown := coalesce(p_breakdown, '[]'::jsonb);
    score := null;
    return;
  end if;
  for e in select value from jsonb_array_elements(p_breakdown) loop
    if e ->> 'key' = 'iletisim' then
      v_w := coalesce((e ->> 'weight')::numeric, 0);
      if e ? 'base_factor' then
        v_base_f := coalesce((e ->> 'base_factor')::numeric, 0);
        v_base_r := coalesce(e ->> 'base_reason', 'Teklif yolu belirsiz');
      elsif coalesce(e ->> 'reason', '') like 'Doğrulanmış%' then
        v_base_f := 0;
        v_base_r := 'Teklif yolu belirsiz';
      else
        v_base_f := coalesce((e ->> 'factor')::numeric, 0);
        v_base_r := coalesce(e ->> 'reason', 'Teklif yolu belirsiz');
      end if;
      if coalesce(p_strong, 0) > 0 then
        v_f := 1;
        v_r := 'Doğrulanmış tedarikçi portalı / satın alma kanalı var';
      elsif coalesce(p_any, 0) > 0 then
        v_f := greatest(0.7, v_base_f);
        v_r := 'Doğrulanmış genel iletişim kanalı var';
      else
        v_f := v_base_f;
        v_r := v_base_r;
      end if;
      e := e || jsonb_build_object('factor', round(v_f, 2), 'points', round(v_w * v_f, 1), 'reason', v_r,
                                   'base_factor', round(v_base_f, 2), 'base_reason', v_base_r);
    end if;
    v_sum := v_sum + coalesce((e ->> 'points')::numeric, 0);
    v_out := v_out || jsonb_build_array(e);
  end loop;
  breakdown := v_out;
  score := greatest(0, least(100, round(v_sum)))::integer;
end;
$$;

create or replace function public.tg_radar_opportunity_rescore()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_strong integer;
  v_any integer;
  r record;
begin
  if not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(new.score_breakdown) = 'array' then new.score_breakdown else '[]'::jsonb end) x
                  where x.value ->> 'key' = 'iletisim') then
    return new;
  end if;
  select count(*) filter (where c.kind in ('tedarikci_portali', 'ihale_adresi', 'satinalma_eposta')), count(*)
    into v_strong, v_any
    from public.radar_opportunity_companies oc
    join public.radar_contacts c on c.company_id = oc.company_id
   where oc.opportunity_id = new.id;
  select * into r from public.radar_rescore_breakdown(new.score_breakdown, v_strong, v_any);
  new.score_breakdown := r.breakdown;
  if r.score is not null then
    new.score := r.score;
  end if;
  return new;
end;
$$;

drop trigger if exists radar_opportunity_rescore on public.radar_opportunities;
create trigger radar_opportunity_rescore
  before update of score_breakdown on public.radar_opportunities
  for each row execute function public.tg_radar_opportunity_rescore();

-- Kanal veya firma bağlantısı değişince ilgili fırsatlar yeniden puanlanır
create or replace function public.tg_radar_contacts_rescore()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'radar_contacts' then
    update public.radar_opportunities o
       set score_breakdown = o.score_breakdown
     where o.id in (select oc.opportunity_id from public.radar_opportunity_companies oc
                     where oc.company_id in (coalesce(new.company_id, old.company_id), coalesce(old.company_id, new.company_id)));
  else
    update public.radar_opportunities o
       set score_breakdown = o.score_breakdown
     where o.id in (coalesce(new.opportunity_id, old.opportunity_id), coalesce(old.opportunity_id, new.opportunity_id));
  end if;
  return null;
end;
$$;

drop trigger if exists radar_contacts_rescore on public.radar_contacts;
create trigger radar_contacts_rescore
  after insert or delete or update of company_id, kind on public.radar_contacts
  for each row execute function public.tg_radar_contacts_rescore();

drop trigger if exists radar_opportunity_companies_rescore on public.radar_opportunity_companies;
create trigger radar_opportunity_companies_rescore
  after insert or delete or update of company_id, opportunity_id on public.radar_opportunity_companies
  for each row execute function public.tg_radar_contacts_rescore();

revoke all on function public.radar_rescore_breakdown(jsonb, integer, integer) from public, anon, authenticated;
revoke all on function public.tg_radar_opportunity_rescore() from public, anon, authenticated;
revoke all on function public.tg_radar_contacts_rescore() from public, anon, authenticated;

-- Mevcut kayıtlar: iletişim kanalı bulunmuş fırsatlar bir kez yeniden puanlanır (tekrar çalıştırılabilir)
update public.radar_opportunities o
   set score_breakdown = o.score_breakdown
 where exists (select 1 from public.radar_opportunity_companies oc join public.radar_contacts c on c.company_id = oc.company_id
                where oc.opportunity_id = o.id);

-- =====================================================================
-- C) FIRSATTAN TEKLİF TASLAĞI — fırsat başına tek teklif
--   Revizyon ve kopyalar (copy_quote) bu sütunu taşımaz; yalnız ilk taslak bağlıdır.
-- =====================================================================
alter table public.quotes add column if not exists radar_opportunity_id uuid references public.radar_opportunities (id) on delete set null;
create unique index if not exists quotes_radar_opportunity_unique on public.quotes (radar_opportunity_id) where radar_opportunity_id is not null;

-- =====================================================================
-- D) CİHAZ KAYDI
--   Kayıt kodu kalıcı kimlik bilgisi DEĞİLDİR: yalnız SHA-256 özeti saklanır, en çok 30 dakika geçerlidir,
--   tek kullanımlıktır ve yeni kod açılınca öncekiler geçersiz olur. Kod, Supabase SQL Editor'dan
--   (postgres) veya yetkili bir cihazdan (sahip oturumu) açılır. Kodu yalnız owner-login (service_role)
--   tüketir. Kayıtlı cihaz, Supabase oturumu (yenileme belirteci) ile hatırlanır; iptal edilen cihazın
--   oturumu silinir ve uygulama açılışta oturumu kapatır.
-- =====================================================================
create table if not exists leonx_private.owner_enrollment (
  id           uuid primary key default gen_random_uuid(),
  code_hash    text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at   timestamptz not null,
  used_at      timestamptz,
  created_at   timestamptz not null default now(),
  constraint owner_enrollment_window check (expires_at <= created_at + interval '30 minutes')
);
revoke all on table leonx_private.owner_enrollment from public, anon, authenticated;

create table if not exists public.owner_devices (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid unique,
  label        text not null default 'Cihaz' check (char_length(label) between 1 and 120),
  method       text not null check (method in ('kod', 'sifre')),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at   timestamptz
);
alter table public.owner_devices enable row level security;
drop policy if exists owner_devices_select on public.owner_devices;
create policy owner_devices_select on public.owner_devices for select to authenticated using ((select public.is_owner()));
revoke all on table public.owner_devices from public, anon, authenticated;
grant select on table public.owner_devices to authenticated;

-- Kod açar; bitiş zamanını döner. Yalnız sahip oturumu veya veritabanı yöneticisi (SQL Editor).
create or replace function public.owner_enrollment_open(p_code text, p_minutes integer default 15)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exp timestamptz;
begin
  if not (public.is_owner() or (auth.uid() is null and session_user in ('postgres', 'supabase_admin'))) then
    raise exception 'Yetkisiz' using errcode = '42501';
  end if;
  if p_code is null or char_length(p_code) not between 6 and 64 or p_code ~ '\s' then
    raise exception 'Kod 6–64 karakter olmalı ve boşluk içermemeli' using errcode = '22023';
  end if;
  if p_minutes is null or p_minutes not between 1 and 30 then
    raise exception 'Geçerlilik 1–30 dakika olmalı' using errcode = '22023';
  end if;
  update leonx_private.owner_enrollment set expires_at = now() where used_at is null and expires_at > now();
  v_exp := now() + make_interval(mins => p_minutes);
  insert into leonx_private.owner_enrollment (code_hash, expires_at) values (encode(sha256(convert_to(p_code, 'UTF8')), 'hex'), v_exp);
  delete from leonx_private.owner_enrollment where created_at < now() - interval '30 days';
  return v_exp;
end;
$$;

-- Kodu tüketir (tek kullanım, süre sınırı). Eşleşirse true. Yalnız service_role (owner-login).
create or replace function public.owner_enrollment_consume(p_code_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Geçersiz kod özeti' using errcode = '22023';
  end if;
  update leonx_private.owner_enrollment e
     set used_at = now()
   where e.id = (select x.id from leonx_private.owner_enrollment x
                  where x.used_at is null and x.expires_at > now() and x.code_hash = p_code_hash
                  order by x.created_at desc limit 1 for update skip locked)
  returning e.id into v_id;
  return v_id is not null;
end;
$$;

-- Başarılı girişten sonra cihazı kaydeder. Yalnız service_role.
create or replace function public.owner_device_register(p_session uuid, p_label text, p_method text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_method not in ('kod', 'sifre') then
    raise exception 'Geçersiz yöntem' using errcode = '22023';
  end if;
  insert into public.owner_devices (session_id, label, method)
  values (p_session, coalesce(nullif(left(btrim(coalesce(p_label, '')), 120), ''), 'Cihaz'), p_method)
  on conflict (session_id) do update set last_seen_at = now(), revoked_at = null
  returning id into v_id;
  return v_id;
end;
$$;

-- Açılışta: oturumun cihazı iptal edilmişse 'iptal' döner (istemci oturumu kapatır); değilse son görülmeyi yazar.
create or replace function public.owner_device_touch()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session uuid := nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'session_id', '')::uuid;
  v_revoked timestamptz;
  v_found boolean;
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz' using errcode = '42501';
  end if;
  if v_session is null then
    return 'bilinmiyor';
  end if;
  select true, d.revoked_at into v_found, v_revoked from public.owner_devices d where d.session_id = v_session;
  if v_found is null then
    return 'kayitsiz';
  end if;
  if v_revoked is not null then
    return 'iptal';
  end if;
  update public.owner_devices set last_seen_at = now() where session_id = v_session and last_seen_at < now() - interval '5 minutes';
  return 'yetkili';
end;
$$;

-- Cihaz iptali: kayıt işaretlenir ve Supabase oturumu (yenileme belirteci) silinir.
create or replace function public.owner_device_revoke(p_device uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session uuid;
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz' using errcode = '42501';
  end if;
  update public.owner_devices set revoked_at = coalesce(revoked_at, now()) where id = p_device returning session_id into v_session;
  if not found then
    raise exception 'Cihaz bulunamadı' using errcode = 'P0002';
  end if;
  if v_session is not null and to_regclass('auth.sessions') is not null then
    execute 'delete from auth.sessions where id = $1' using v_session;
  end if;
end;
$$;

revoke all on function public.owner_enrollment_open(text, integer) from public, anon;
revoke all on function public.owner_enrollment_consume(text) from public, anon, authenticated;
revoke all on function public.owner_device_register(uuid, text, text) from public, anon, authenticated;
revoke all on function public.owner_device_touch() from public, anon;
revoke all on function public.owner_device_revoke(uuid) from public, anon;
grant execute on function public.owner_enrollment_open(text, integer) to authenticated;
grant execute on function public.owner_device_touch() to authenticated;
grant execute on function public.owner_device_revoke(uuid) to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.owner_enrollment_consume(text) to service_role';
    execute 'grant execute on function public.owner_device_register(uuid, text, text) to service_role';
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'owner_devices') then
    execute 'alter publication supabase_realtime add table public.owner_devices';
  end if;
end;
$$;
