-- =====================================================================
-- LEONX OS — 007: İş akışı (Faz 7)
--
--   A) Proje aşamaları (12 aşama), ilerleme, adres, harita bağlantısı, gerçek bitiş tarihi
--      Eski "status" sütunu korunur ve aşamayla iki yönlü eşitlenir (eski istemciler bozulmaz).
--   B) Proje görevleri (termin, hatırlatma, tamamlanma)
--   C) Proje zaman çizelgesi (gerçek olaylardan, tekilleştirilmiş)
--   D) Bildirimler, bildirim tercihleri, push abonelikleri
--   E) Olay tetikleyicileri (müşteri, proje, dosya, CAD, metraj, teklif, görev)
--   F) Zamanlanmış hatırlatma taraması (görev, termin, teklif geçerliliği)
--   G) Push gönderimi için özel (istemciye kapalı) yapılandırma şeması
--
-- Tekrar çalıştırılabilir. Hiçbir nesne veya veri silinmez; mevcut kayıtlar yalnızca
-- yeni sütunlar için doldurulur.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Ortak: politika yardımcısı (oturumluk)
-- ---------------------------------------------------------------------
create or replace function pg_temp.leonx_policy(
  p_schema text, p_table text, p_name text, p_cmd text, p_using text, p_check text
) returns void
language plpgsql
as $fn$
begin
  if exists (select 1 from pg_policies where schemaname = p_schema and tablename = p_table and policyname = p_name) then
    execute format('alter policy %I on %I.%I to authenticated', p_name, p_schema, p_table)
      || coalesce(' using (' || p_using || ')', '')
      || coalesce(' with check (' || p_check || ')', '');
  else
    execute format('create policy %I on %I.%I for %s to authenticated', p_name, p_schema, p_table, p_cmd)
      || coalesce(' using (' || p_using || ')', '')
      || coalesce(' with check (' || p_check || ')', '');
  end if;
end;
$fn$;

create or replace function pg_temp.leonx_constraint(p_table text, p_name text, p_def text)
returns void
language plpgsql
as $fn$
begin
  if not exists (select 1 from pg_constraint where conname = p_name and conrelid = ('public.' || p_table)::regclass) then
    execute format('alter table public.%I add constraint %I %s', p_table, p_name, p_def);
  end if;
end;
$fn$;

-- =====================================================================
-- A) PROJE AŞAMALARI
-- =====================================================================
alter table public.projects add column if not exists stage        text;
alter table public.projects add column if not exists progress     smallint not null default 0;
alter table public.projects add column if not exists on_hold      boolean not null default false;
alter table public.projects add column if not exists completed_on date;
alter table public.projects add column if not exists address      text;
alter table public.projects add column if not exists map_url      text;

select pg_temp.leonx_constraint('projects', 'projects_stage_check', $c$check (stage in (
  'yeni_firsat', 'teklif_hazirlaniyor', 'teklif_gonderildi', 'gorusme', 'onaylandi', 'olcu_kesif',
  'uretime_hazirlik', 'uretimde', 'montajda', 'tamamlandi', 'teslim_edildi', 'iptal'))$c$);
select pg_temp.leonx_constraint('projects', 'projects_progress_check', 'check (progress between 0 and 100)');
select pg_temp.leonx_constraint('projects', 'projects_address_check', 'check (address is null or char_length(address) <= 500)');
select pg_temp.leonx_constraint('projects', 'projects_map_url_check', $c$check (map_url is null or (char_length(map_url) <= 500 and map_url ~* '^https://'))$c$);
select pg_temp.leonx_constraint('projects', 'projects_completed_check', 'check (completed_on is null or start_date is null or completed_on >= start_date)');

-- Eski durum → yeni aşama (yalnız ilk geçişte; "beklemede" bir bayrağa dönüşür)
create or replace function public.leonx_stage_from_status(p_status text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_status
    when 'kesif' then 'olcu_kesif'
    when 'olcu' then 'olcu_kesif'
    when 'tasarim' then 'uretime_hazirlik'
    when 'teklif' then 'teklif_hazirlaniyor'
    when 'uretim' then 'uretimde'
    when 'montaj' then 'montajda'
    when 'tamamlandi' then 'tamamlandi'
    when 'iptal' then 'iptal'
    when 'beklemede' then 'gorusme'
    else 'yeni_firsat'
  end;
$$;

-- Yeni aşama → eski durum (eski sürümde açık kalan istemciler geçerli değer görür)
create or replace function public.leonx_status_from_stage(p_stage text, p_on_hold boolean)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_on_hold and p_stage not in ('tamamlandi', 'teslim_edildi', 'iptal') then 'beklemede'
    else case p_stage
      when 'yeni_firsat' then 'kesif'
      when 'olcu_kesif' then 'olcu'
      when 'uretime_hazirlik' then 'tasarim'
      when 'uretimde' then 'uretim'
      when 'montajda' then 'montaj'
      when 'tamamlandi' then 'tamamlandi'
      when 'teslim_edildi' then 'tamamlandi'
      when 'iptal' then 'iptal'
      else 'teklif'
    end
  end;
$$;

-- Aşamanın asgari ilerleme yüzdesi (kullanıcı daha yüksek değer girebilir; otomatik düşürülmez)
create or replace function public.leonx_stage_progress(p_stage text)
returns smallint
language sql
immutable
set search_path = ''
as $$
  select (case p_stage
    when 'yeni_firsat' then 0 when 'teklif_hazirlaniyor' then 5 when 'teklif_gonderildi' then 10
    when 'gorusme' then 15 when 'onaylandi' then 25 when 'olcu_kesif' then 30
    when 'uretime_hazirlik' then 40 when 'uretimde' then 55 when 'montajda' then 80
    when 'tamamlandi' then 100 when 'teslim_edildi' then 100 else 0 end)::smallint;
$$;

-- Mevcut kayıtlar: aşama yoksa eski durumdan türetilir (veri silinmez)
update public.projects
set stage = public.leonx_stage_from_status(status),
    on_hold = (status = 'beklemede'),
    progress = greatest(progress, public.leonx_stage_progress(public.leonx_stage_from_status(status)))
where stage is null;

alter table public.projects alter column stage set default 'yeni_firsat';
alter table public.projects alter column stage set not null;
create index if not exists projects_stage_idx on public.projects (stage);

create or replace function public.tg_project_stage_sync()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- Eski istemci yalnız "status" gönderdiyse aşama ondan türetilir
    if new.stage = 'yeni_firsat' and new.status not in ('kesif') then
      new.stage := public.leonx_stage_from_status(new.status);
      new.on_hold := new.on_hold or new.status = 'beklemede';
    end if;
  elsif new.stage is not distinct from old.stage and new.on_hold is not distinct from old.on_hold
        and new.status is distinct from old.status then
    -- Eski istemci durumu değiştirdi
    if new.status = 'beklemede' then
      new.on_hold := true;
    else
      new.on_hold := false;
      if public.leonx_status_from_stage(old.stage, false) is distinct from new.status then
        new.stage := public.leonx_stage_from_status(new.status);
      end if;
    end if;
  end if;
  new.status := public.leonx_status_from_stage(new.stage, new.on_hold);
  new.progress := greatest(coalesce(new.progress, 0), public.leonx_stage_progress(new.stage));
  if new.stage in ('tamamlandi', 'teslim_edildi') then
    new.completed_on := coalesce(new.completed_on, (now() at time zone 'Europe/Istanbul')::date);
  end if;
  return new;
end;
$$;

create or replace trigger project_stage_sync
  before insert or update on public.projects
  for each row execute function public.tg_project_stage_sync();

-- Durum geçmişi, aşama değişiminden türeyen durum değişikliklerini de kaydetsin
-- (sütuna bağlı tetikleyici yalnız UPDATE listesindeki sütunlara bakar)
create or replace trigger project_status_history
  after insert or update of status, stage, on_hold on public.projects
  for each row execute function public.tg_project_status_history();

-- =====================================================================
-- B) GÖREVLER
-- =====================================================================
create table if not exists public.project_tasks (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  title       text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (description is null or char_length(description) <= 5000),
  priority    text not null default 'normal' check (priority in ('dusuk', 'normal', 'yuksek', 'acil')),
  start_date  date,
  due_date    date,
  remind_at   timestamptz,
  done        boolean not null default false,
  done_at     timestamptz,
  notes       text check (notes is null or char_length(notes) <= 5000),
  sort_order  integer not null default 0,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  version     integer not null default 1 check (version >= 1),
  constraint project_tasks_dates_check check (due_date is null or start_date is null or due_date >= start_date)
);
create index if not exists project_tasks_project_idx on public.project_tasks (project_id, done, due_date);
create index if not exists project_tasks_due_idx on public.project_tasks (due_date) where not done;
create index if not exists project_tasks_remind_idx on public.project_tasks (remind_at) where not done;

create or replace trigger set_created_by before insert on public.project_tasks for each row execute function public.tg_set_created_by();
create or replace trigger touch_row before update on public.project_tasks for each row execute function public.tg_touch_row();

create or replace function public.tg_task_done()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.done and (tg_op = 'INSERT' or not old.done) then
    new.done_at := now();
  elsif not new.done then
    new.done_at := null;
  end if;
  return new;
end;
$$;
create or replace trigger task_done before insert or update on public.project_tasks
  for each row execute function public.tg_task_done();

-- =====================================================================
-- C) ZAMAN ÇİZELGESİ (yalnız tetikleyiciler yazar)
-- =====================================================================
create table if not exists public.project_events (
  id          bigint generated always as identity primary key,
  project_id  uuid not null references public.projects (id) on delete cascade,
  kind        text not null check (char_length(kind) between 1 and 40),
  title       text not null check (char_length(title) between 1 and 300),
  detail      text check (detail is null or char_length(detail) <= 1000),
  ref_type    text check (ref_type is null or char_length(ref_type) <= 40),
  ref_id      uuid,
  actor       uuid,
  created_at  timestamptz not null default now(),
  dedupe_key  text unique check (dedupe_key is null or char_length(dedupe_key) <= 200)
);
create index if not exists project_events_project_idx on public.project_events (project_id, created_at desc);

create or replace function public.leonx_event(
  p_project uuid, p_kind text, p_title text, p_detail text, p_ref_type text, p_ref_id uuid, p_dedupe text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_project is null then return; end if;
  insert into public.project_events (project_id, kind, title, detail, ref_type, ref_id, actor, dedupe_key)
  values (p_project, p_kind, left(p_title, 300), left(p_detail, 1000), p_ref_type, p_ref_id, auth.uid(), p_dedupe)
  on conflict (dedupe_key) do nothing;
end;
$$;
revoke all on function public.leonx_event(uuid, text, text, text, text, uuid, text) from public, anon, authenticated;

-- =====================================================================
-- D) BİLDİRİMLER, TERCİHLER, PUSH ABONELİKLERİ
-- =====================================================================
create table if not exists public.notifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  category      text not null check (category in ('proje', 'teklif', 'cad', 'gorev', 'termin', 'sistem')),
  kind          text not null check (char_length(kind) between 1 and 40),
  title         text not null check (char_length(title) between 1 and 200),
  body          text check (body is null or char_length(body) <= 500),
  link          text check (link is null or (char_length(link) <= 300 and link ~ '^/')),
  entity_type   text check (entity_type is null or char_length(entity_type) <= 40),
  entity_id     uuid,
  dedupe_key    text not null check (char_length(dedupe_key) between 1 and 200),
  actor         uuid,
  read_at       timestamptz,
  push_state    text not null default 'yok' check (push_state in ('yok', 'bekliyor', 'gonderildi', 'basarisiz')),
  push_attempts smallint not null default 0,
  created_at    timestamptz not null default now(),
  constraint notifications_dedupe_unique unique (user_id, dedupe_key)
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (user_id) where read_at is null;
create index if not exists notifications_push_idx on public.notifications (created_at) where push_state = 'bekliyor';

create table if not exists public.notification_prefs (
  user_id     uuid primary key default auth.uid(),
  in_app      boolean not null default true,
  push        boolean not null default false,
  cat_proje   boolean not null default true,
  cat_teklif  boolean not null default true,
  cat_cad     boolean not null default true,
  cat_gorev   boolean not null default true,
  cat_termin  boolean not null default true,
  cat_sistem  boolean not null default true,
  own_actions boolean not null default true,
  updated_at  timestamptz not null default now(),
  version     integer not null default 1 check (version >= 1)
);

create or replace function public.tg_prefs_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.user_id := auth.uid();
    new.version := 1;
  else
    new.user_id := old.user_id;
    new.version := old.version + 1;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create or replace trigger prefs_touch before insert or update on public.notification_prefs
  for each row execute function public.tg_prefs_touch();

create table if not exists public.push_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null,
  endpoint        text not null unique check (char_length(endpoint) <= 1000 and endpoint ~ '^https://'),
  p256dh          text not null check (char_length(p256dh) between 20 and 200),
  auth_key        text not null check (char_length(auth_key) between 8 and 100),
  user_agent      text check (user_agent is null or char_length(user_agent) <= 300),
  device_label    text check (device_label is null or char_length(device_label) <= 100),
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count   smallint not null default 0,
  disabled_at     timestamptz
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id) where disabled_at is null;

-- Bildirim oluşturma: tercihleri uygular, olay anahtarıyla tekilleştirir. Alıcı: uygulama sahibi.
create or replace function public.leonx_notify(
  p_category text, p_kind text, p_title text, p_body text, p_link text,
  p_entity_type text, p_entity_id uuid, p_dedupe text, p_system boolean
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid := (select user_id from public.app_owner limit 1);
  v_prefs public.notification_prefs;
  -- Sistem olayları (hatırlatma, termin, sürüm) bir kullanıcı işlemi sayılmaz
  v_actor uuid := case when p_system then null else auth.uid() end;
  v_push  boolean;
  v_cat   boolean;
begin
  if v_user is null or p_dedupe is null then return; end if;
  select * into v_prefs from public.notification_prefs where user_id = v_user;
  if found then
    if not v_prefs.in_app then return; end if;
    v_cat := (case p_category
      when 'proje' then v_prefs.cat_proje when 'teklif' then v_prefs.cat_teklif when 'cad' then v_prefs.cat_cad
      when 'gorev' then v_prefs.cat_gorev when 'termin' then v_prefs.cat_termin else v_prefs.cat_sistem end);
    if not v_cat then
      return;
    end if;
    if not v_prefs.own_actions and v_actor is not null and v_actor = v_user then return; end if;
    v_push := v_prefs.push;
  else
    v_push := false;
  end if;
  v_push := v_push and exists (select 1 from public.push_subscriptions where user_id = v_user and disabled_at is null);
  insert into public.notifications (user_id, category, kind, title, body, link, entity_type, entity_id, dedupe_key, actor, push_state)
  values (v_user, p_category, p_kind, left(p_title, 200), left(p_body, 500), p_link, p_entity_type, p_entity_id,
          left(p_dedupe, 200), v_actor, case when v_push then 'bekliyor' else 'yok' end)
  on conflict (user_id, dedupe_key) do nothing;
end;
$$;
revoke all on function public.leonx_notify(text, text, text, text, text, text, uuid, text, boolean) from public, anon, authenticated;

-- Kullanıcı işlemlerinden doğan bildirimler (işlemi yapan kişi kaydedilir)
create or replace function public.leonx_notify(
  p_category text, p_kind text, p_title text, p_body text, p_link text,
  p_entity_type text, p_entity_id uuid, p_dedupe text
) returns void
language sql
security definer
set search_path = ''
as $$
  select public.leonx_notify(p_category, p_kind, p_title, p_body, p_link, p_entity_type, p_entity_id, p_dedupe, false);
$$;
revoke all on function public.leonx_notify(text, text, text, text, text, text, uuid, text) from public, anon, authenticated;

-- =====================================================================
-- E) OLAY TETİKLEYİCİLERİ
-- =====================================================================
create or replace function public.leonx_stage_label(p_stage text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_stage
    when 'yeni_firsat' then 'Yeni fırsat' when 'teklif_hazirlaniyor' then 'Teklif hazırlanıyor'
    when 'teklif_gonderildi' then 'Teklif gönderildi' when 'gorusme' then 'Görüşme aşamasında'
    when 'onaylandi' then 'Onaylandı' when 'olcu_kesif' then 'Ölçü / keşif'
    when 'uretime_hazirlik' then 'Üretime hazırlık' when 'uretimde' then 'Üretimde'
    when 'montajda' then 'Montajda' when 'tamamlandi' then 'Tamamlandı'
    when 'teslim_edildi' then 'Teslim edildi' when 'iptal' then 'İptal edildi' else p_stage end;
$$;

create or replace function public.tg_wf_company()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.leonx_notify('proje', 'musteri_yeni', 'Yeni müşteri: ' || new.name, null,
    '/firmalar/' || new.id, 'company', new.id, 'company:' || new.id || ':yeni');
  return null;
end;
$$;
create or replace trigger wf_company after insert on public.companies for each row execute function public.tg_wf_company();

create or replace function public.tg_wf_project()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := new.code || ' · ' || new.name;
begin
  if tg_op = 'INSERT' then
    perform public.leonx_event(new.id, 'proje_olustu', 'Proje oluşturuldu', public.leonx_stage_label(new.stage), 'project', new.id, 'project:' || new.id || ':yeni');
    perform public.leonx_notify('proje', 'proje_yeni', 'Yeni proje: ' || v_name, null, '/projeler/' || new.id, 'project', new.id, 'project:' || new.id || ':yeni');
  else
    if new.stage is distinct from old.stage then
      perform public.leonx_event(new.id, 'asama', public.leonx_stage_label(new.stage),
        public.leonx_stage_label(old.stage) || ' → ' || public.leonx_stage_label(new.stage), 'project', new.id, null);
      perform public.leonx_notify('proje', 'proje_asama', v_name || ': ' || public.leonx_stage_label(new.stage),
        public.leonx_stage_label(old.stage) || ' → ' || public.leonx_stage_label(new.stage), '/projeler/' || new.id, 'project', new.id,
        'project:' || new.id || ':asama:' || new.stage || ':' || to_char(now(), 'YYYYMMDDHH24MI'));
    end if;
    if new.on_hold is distinct from old.on_hold then
      perform public.leonx_event(new.id, 'beklemede', case when new.on_hold then 'Beklemeye alındı' else 'Beklemeden çıkarıldı' end, null, 'project', new.id, null);
    end if;
  end if;
  return null;
end;
$$;
create or replace trigger wf_project after insert or update on public.projects for each row execute function public.tg_wf_project();

create or replace function public.tg_wf_file()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.leonx_event(new.project_id, 'dosya', 'Dosya yüklendi', new.file_name, 'project_file', new.id, 'file:' || new.id);
  perform public.leonx_notify('proje', 'dosya_yeni', 'Yeni dosya: ' || new.file_name,
    (select code || ' · ' || name from public.projects where id = new.project_id),
    '/projeler/' || new.project_id, 'project', new.project_id, 'file:' || new.id);
  return null;
end;
$$;
create or replace trigger wf_file after insert on public.project_files for each row execute function public.tg_wf_file();

create or replace function public.tg_wf_cad()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.leonx_event(new.project_id, 'cad_analiz',
    case when new.status = 'hatali' then 'CAD analizi hata verdi' else 'CAD analizi kaydedildi' end,
    new.file_name || ' · ' || new.candidate_count || ' aday', 'cad_analysis', new.id, 'cad:' || new.id);
  perform public.leonx_notify('cad', case when new.status = 'hatali' then 'cad_hata' else 'cad_tamam' end,
    case when new.status = 'hatali' then 'CAD analizi hata verdi: ' else 'CAD analizi tamamlandı: ' end || new.file_name,
    new.candidate_count || ' poz adayı', '/projeler/' || new.project_id, 'project', new.project_id, 'cad:' || new.id);
  return null;
end;
$$;
create or replace trigger wf_cad after insert on public.cad_analyses for each row execute function public.tg_wf_cad();

create or replace function public.tg_wf_takeoff()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link text := '/metraj?proje=' || new.project_id || '&surum=' || new.id;
begin
  if tg_op = 'INSERT' then
    perform public.leonx_event(new.project_id, 'metraj', case when new.revision > 1 then 'Metraj revize edildi' else 'Metraj hazırlandı' end,
      'Rev ' || new.revision || ' · ' || new.name, 'takeoff', new.id, 'takeoff:' || new.id);
    perform public.leonx_notify('cad', case when new.revision > 1 then 'metraj_revize' else 'metraj_yeni' end,
      case when new.revision > 1 then 'Metraj revize edildi: Rev ' else 'Metraj hazırlandı: Rev ' end || new.revision,
      new.name, v_link, 'project', new.project_id, 'takeoff:' || new.id);
  elsif new.status = 'onaylandi' and old.status is distinct from 'onaylandi' then
    perform public.leonx_event(new.project_id, 'metraj_onay', 'Metraj onaylandı', 'Rev ' || new.revision || ' · ' || new.name, 'takeoff', new.id, 'takeoff:' || new.id || ':onay');
    perform public.leonx_notify('cad', 'metraj_onay', 'Metraj onaylandı: Rev ' || new.revision, new.name, v_link, 'project', new.project_id, 'takeoff:' || new.id || ':onay');
  end if;
  return null;
end;
$$;
create or replace trigger wf_takeoff after insert or update on public.quantity_takeoffs for each row execute function public.tg_wf_takeoff();

create or replace function public.tg_wf_quote()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label text := new.quote_no || ' Rev ' || new.revision;
  v_link  text := '/teklifler/' || new.id;
begin
  if tg_op = 'INSERT' then
    perform public.leonx_event(new.project_id, 'teklif', case when new.revision > 1 then 'Teklif revizyonu eklendi' else 'Teklif eklendi' end,
      v_label || ' · ' || new.title, 'quote', new.id, 'quote:' || new.id || ':yeni');
    perform public.leonx_notify('teklif', 'teklif_yeni', case when new.revision > 1 then 'Teklif revizyonu: ' else 'Teklif oluşturuldu: ' end || v_label,
      new.title, v_link, 'quote', new.id, 'quote:' || new.id || ':yeni');
  elsif new.status is distinct from old.status and new.status in ('gonderildi', 'kabul', 'red') then
    perform public.leonx_event(new.project_id, 'teklif_' || new.status,
      case new.status when 'gonderildi' then 'Teklif gönderildi' when 'kabul' then 'Teklif kabul edildi' else 'Teklif reddedildi' end,
      v_label || ' · ' || new.title, 'quote', new.id, 'quote:' || new.id || ':' || new.status);
    perform public.leonx_notify('teklif', 'teklif_' || new.status,
      case new.status when 'gonderildi' then 'Teklif gönderildi: ' when 'kabul' then 'Teklif kabul edildi: ' else 'Teklif reddedildi: ' end || v_label,
      case when new.status = 'kabul' and new.project_id is not null then 'Proje aşamasını güncellemeyi unutmayın.' else new.title end,
      case when new.status = 'kabul' and new.project_id is not null then '/projeler/' || new.project_id else v_link end,
      'quote', new.id, 'quote:' || new.id || ':' || new.status);
  end if;
  return null;
end;
$$;
create or replace trigger wf_quote after insert or update on public.quotes for each row execute function public.tg_wf_quote();

create or replace function public.tg_wf_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.leonx_event(new.project_id, 'gorev_eklendi', 'Görev eklendi', new.title, 'task', new.id, 'task:' || new.id || ':yeni');
  end if;
  if new.done and (tg_op = 'INSERT' or not old.done) then
    -- Aynı tamamlanma bir kez kaydedilir (dakika çözünürlüğünde)
    perform public.leonx_event(new.project_id, 'gorev_tamam', 'Görev tamamlandı', new.title, 'task', new.id,
      'task:' || new.id || ':tamam:' || to_char(coalesce(new.done_at, now()), 'YYYYMMDDHH24MI'));
  end if;
  return null;
end;
$$;
create or replace trigger wf_task after insert or update on public.project_tasks for each row execute function public.tg_wf_task();

-- Mevcut kayıtlardan zaman çizelgesi (yalnız ilk geçişte etkili; tekilleştirme anahtarlı)
insert into public.project_events (project_id, kind, title, detail, ref_type, ref_id, actor, created_at, dedupe_key)
select id, 'proje_olustu', 'Proje oluşturuldu', null, 'project', id, created_by, created_at, 'project:' || id || ':yeni' from public.projects
on conflict (dedupe_key) do nothing;
insert into public.project_events (project_id, kind, title, detail, ref_type, ref_id, actor, created_at, dedupe_key)
select project_id, 'dosya', 'Dosya yüklendi', file_name, 'project_file', id, created_by, created_at, 'file:' || id from public.project_files
on conflict (dedupe_key) do nothing;
insert into public.project_events (project_id, kind, title, detail, ref_type, ref_id, actor, created_at, dedupe_key)
select project_id, 'teklif', 'Teklif eklendi', quote_no || ' Rev ' || revision || ' · ' || title, 'quote', id, created_by, created_at, 'quote:' || id || ':yeni'
from public.quotes where project_id is not null
on conflict (dedupe_key) do nothing;
insert into public.project_events (project_id, kind, title, detail, ref_type, ref_id, actor, created_at, dedupe_key)
select project_id, 'metraj', 'Metraj hazırlandı', 'Rev ' || revision || ' · ' || name, 'takeoff', id, created_by, created_at, 'takeoff:' || id from public.quantity_takeoffs
on conflict (dedupe_key) do nothing;

-- =====================================================================
-- F) ZAMANLANMIŞ HATIRLATMALAR
-- Sunucuda pg_cron ile periyodik çalışır (migration 008); uygulama açılışında sahip de
-- check_reminders() ile tetikleyebilir. Tekilleştirme anahtarları sayesinde tekrar
-- çalıştırmak aynı bildirimi ikinci kez üretmez.
-- =====================================================================
create or replace function public.leonx_run_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Europe/Istanbul')::date;
  v_before integer := (select count(*) from public.notifications);
  r record;
begin
  -- Görev hatırlatma zamanı geldi
  for r in select t.*, p.code from public.project_tasks t join public.projects p on p.id = t.project_id
           where not t.done and t.remind_at is not null and t.remind_at <= now() and t.remind_at > now() - interval '7 days' loop
    perform public.leonx_notify('gorev', 'gorev_hatirlatma', 'Görev zamanı: ' || r.title, r.code, '/projeler/' || r.project_id || '?sekme=gorevler',
      'task', r.id, 'task:' || r.id || ':hatirlatma:' || to_char(r.remind_at, 'YYYYMMDDHH24MI'), true);
  end loop;
  -- Bugün biten görev
  for r in select t.*, p.code from public.project_tasks t join public.projects p on p.id = t.project_id
           where not t.done and t.due_date = v_today loop
    perform public.leonx_notify('gorev', 'gorev_bugun', 'Bugün bitmesi gereken görev: ' || r.title, r.code, '/projeler/' || r.project_id || '?sekme=gorevler',
      'task', r.id, 'task:' || r.id || ':bugun:' || r.due_date, true);
  end loop;
  -- Geciken görev
  for r in select t.*, p.code from public.project_tasks t join public.projects p on p.id = t.project_id
           where not t.done and t.due_date < v_today and t.due_date >= v_today - 30 loop
    perform public.leonx_notify('gorev', 'gorev_gecikti', 'Görev gecikti: ' || r.title, r.code || ' · termin ' || to_char(r.due_date, 'DD.MM.YYYY'),
      '/projeler/' || r.project_id || '?sekme=gorevler', 'task', r.id, 'task:' || r.id || ':gecikti:' || r.due_date, true);
  end loop;
  -- Proje teslim tarihi yaklaşıyor (3 gün) / geçti
  for r in select * from public.projects where due_date is not null and stage not in ('tamamlandi', 'teslim_edildi', 'iptal')
           and due_date between v_today - 30 and v_today + 3 loop
    if r.due_date >= v_today then
      perform public.leonx_notify('termin', 'teslim_yaklasiyor', 'Teslim tarihi yaklaşıyor: ' || r.code,
        r.name || ' · ' || to_char(r.due_date, 'DD.MM.YYYY'), '/projeler/' || r.id, 'project', r.id, 'project:' || r.id || ':termin:' || r.due_date, true);
    else
      perform public.leonx_notify('termin', 'teslim_gecti', 'Teslim tarihi geçti: ' || r.code,
        r.name || ' · ' || to_char(r.due_date, 'DD.MM.YYYY'), '/projeler/' || r.id, 'project', r.id, 'project:' || r.id || ':gecti:' || r.due_date, true);
    end if;
  end loop;
  -- Teklif geçerliliği bitiyor (2 gün), gönderilmiş/görüşmede ve güncel revizyon
  for r in select * from public.quotes where valid_until is not null and not superseded and status in ('gonderildi', 'gorusmede')
           and valid_until between v_today and v_today + 2 loop
    perform public.leonx_notify('teklif', 'teklif_suresi', 'Teklif geçerliliği bitiyor: ' || r.quote_no,
      r.title || ' · ' || to_char(r.valid_until, 'DD.MM.YYYY'), '/teklifler/' || r.id, 'quote', r.id, 'quote:' || r.id || ':gecerlilik:' || r.valid_until, true);
  end loop;
  return (select count(*) from public.notifications) - v_before;
end;
$$;
revoke all on function public.leonx_run_reminders() from public, anon, authenticated;

-- Uygulama açılışında sahip çağırır (sunucu zamanlayıcısı olmasa da hatırlatmalar oluşur)
create or replace function public.check_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz' using errcode = '42501';
  end if;
  return public.leonx_run_reminders();
end;
$$;
revoke all on function public.check_reminders() from public, anon;
grant execute on function public.check_reminders() to authenticated;

-- İstemci kaynaklı olaylar: yeni uygulama sürümü ve kaydedilmemiş CAD analizinin hatası
create or replace function public.notify_client_event(p_kind text, p_title text, p_body text, p_link text, p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz' using errcode = '42501';
  end if;
  if p_kind not in ('surum_yeni', 'cad_hata', 'push_test') then
    raise exception 'Geçersiz olay türü' using errcode = '22023';
  end if;
  if p_link is not null and p_link !~ '^/' then
    raise exception 'Geçersiz bağlantı' using errcode = '22023';
  end if;
  perform public.leonx_notify(case when p_kind = 'cad_hata' then 'cad' else 'sistem' end, p_kind,
    left(p_title, 200), left(p_body, 500), left(p_link, 300), null, null, p_kind || ':' || left(p_key, 150), p_kind <> 'cad_hata');
end;
$$;
revoke all on function public.notify_client_event(text, text, text, text, text) from public, anon;
grant execute on function public.notify_client_event(text, text, text, text, text) to authenticated;

-- Push aboneliği kaydı (aynı uç nokta yeniden kaydedilirse güncellenir)
create or replace function public.register_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text, p_label text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz' using errcode = '42501';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth_key, user_agent, device_label)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300), left(p_label, 100))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth_key = excluded.auth_key,
        user_agent = excluded.user_agent, device_label = coalesce(excluded.device_label, public.push_subscriptions.device_label),
        last_seen_at = now(), failure_count = 0, disabled_at = null
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.register_push_subscription(text, text, text, text, text) from public, anon;
grant execute on function public.register_push_subscription(text, text, text, text, text) to authenticated;

-- =====================================================================
-- G) PUSH YAPILANDIRMASI — istemciye tamamen kapalı şema
-- VAPID anahtar çifti sunucudaki gönderim işlevi tarafından ilk çalışmada üretilir ve
-- yalnız burada saklanır; gizli anahtar istemciye, depoya veya sohbete hiç çıkmaz.
-- =====================================================================
create schema if not exists leonx_private;
revoke all on schema leonx_private from public, anon, authenticated;

create table if not exists leonx_private.push_config (
  singleton     boolean primary key default true check (singleton),
  vapid_public  text,
  vapid_private text,
  vapid_subject text not null default 'mailto:bildirim@leonxmetal.com',
  cron_secret   text not null default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  dispatch_url  text check (dispatch_url is null or dispatch_url ~ '^https://'),
  updated_at    timestamptz not null default now()
);
revoke all on table leonx_private.push_config from public, anon, authenticated;
insert into leonx_private.push_config (singleton) values (true) on conflict (singleton) do nothing;

-- İstemcinin abone olmak için ihtiyaç duyduğu AÇIK anahtar
create or replace function public.push_public_key()
returns text
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz' using errcode = '42501';
  end if;
  return (select vapid_public from leonx_private.push_config where singleton);
end;
$$;
revoke all on function public.push_public_key() from public, anon;
grant execute on function public.push_public_key() to authenticated;

-- Sunucu tarafı gönderim işlevi (Edge Function, service_role) için RPC'ler.
-- İstemci rolleri (anon, authenticated) bunları ÇAĞIRAMAZ.
create or replace function public.push_service_config()
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  select jsonb_build_object('vapid_public', vapid_public, 'vapid_private', vapid_private,
    'vapid_subject', vapid_subject, 'cron_secret', cron_secret)
  from leonx_private.push_config where singleton;
$$;

-- İlk çalışmada üretilen anahtar çifti yalnız boşsa yazılır (eşzamanlı çağrılarda ilk yazan kazanır)
create or replace function public.push_service_set_keys(p_public text, p_private text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update leonx_private.push_config
  set vapid_public = p_public, vapid_private = p_private, updated_at = now()
  where singleton and vapid_public is null;
  return public.push_service_config();
end;
$$;

-- Bekleyen push bildirimlerini sahiplen (aynı bildirim iki kez gönderilmez: SKIP LOCKED + deneme sayacı)
create or replace function public.push_service_claim(p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  with picked as (
    select id from public.notifications
    where push_state = 'bekliyor' and push_attempts < 5 and created_at > now() - interval '2 days'
    order by created_at
    limit greatest(1, least(p_limit, 100))
    for update skip locked
  ), upd as (
    update public.notifications n set push_attempts = n.push_attempts + 1
    from picked where n.id = picked.id
    returning n.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', u.id, 'title', u.title, 'body', u.body, 'link', u.link, 'category', u.category,
    'subscriptions', coalesce((
      select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth_key))
      from public.push_subscriptions s where s.user_id = u.user_id and s.disabled_at is null), '[]'::jsonb)
  )), '[]'::jsonb) into v
  from upd u;
  -- Süresi geçmiş bekleyenler gönderilmez (cihaz uzun süre kapalıysa eski bildirim yağmuru olmaz)
  update public.notifications set push_state = 'basarisiz'
  where push_state = 'bekliyor' and created_at <= now() - interval '2 days';
  return v;
end;
$$;

-- Gönderim sonucu: geçersiz (404/410) abonelikler devre dışı bırakılır, hatalar sayılır
create or replace function public.push_service_report(p_notification uuid, p_sent integer, p_gone text[], p_failed text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.push_subscriptions set disabled_at = now() where endpoint = any (coalesce(p_gone, '{}'));
  update public.push_subscriptions set failure_count = failure_count + 1,
    disabled_at = case when failure_count + 1 >= 10 then now() else disabled_at end
  where endpoint = any (coalesce(p_failed, '{}'));
  update public.push_subscriptions set last_success_at = now(), failure_count = 0
  where p_sent > 0 and disabled_at is null and not (endpoint = any (coalesce(p_failed, '{}')))
    and user_id = (select user_id from public.notifications where id = p_notification);
  update public.notifications set push_state = case
      when p_sent > 0 then 'gonderildi'
      when coalesce(array_length(p_failed, 1), 0) = 0 then 'basarisiz'   -- abone yok / hepsi geçersiz
      when push_attempts >= 5 then 'basarisiz'
      else 'bekliyor' end
  where id = p_notification;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array['public.push_service_config()', 'public.push_service_set_keys(text, text)',
    'public.push_service_claim(integer)', 'public.push_service_report(uuid, integer, text[], text[])'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end;
$$;

-- =====================================================================
-- YETKİLER VE RLS
-- =====================================================================
revoke all on table public.project_tasks, public.project_events, public.notifications,
  public.notification_prefs, public.push_subscriptions from anon;
revoke all on table public.project_tasks, public.project_events, public.notifications,
  public.notification_prefs, public.push_subscriptions from authenticated;

grant select, insert, update, delete on table public.project_tasks to authenticated;
grant select on table public.project_events to authenticated;
grant select on table public.notifications to authenticated;
grant update (read_at) on table public.notifications to authenticated;
grant select, insert, update on table public.notification_prefs to authenticated;
grant select, delete on table public.push_subscriptions to authenticated;
grant update (device_label) on table public.push_subscriptions to authenticated;

alter table public.project_tasks      enable row level security;
alter table public.project_events     enable row level security;
alter table public.notifications      enable row level security;
alter table public.notification_prefs enable row level security;
alter table public.push_subscriptions enable row level security;

select pg_temp.leonx_policy('public', 'project_tasks', 'owner_select', 'select', '(select public.is_owner())', null);
select pg_temp.leonx_policy('public', 'project_tasks', 'owner_insert', 'insert', null, '(select public.is_owner())');
select pg_temp.leonx_policy('public', 'project_tasks', 'owner_update', 'update', '(select public.is_owner())', '(select public.is_owner())');
select pg_temp.leonx_policy('public', 'project_tasks', 'owner_delete', 'delete', '(select public.is_owner())', null);
select pg_temp.leonx_policy('public', 'project_events', 'owner_select', 'select', '(select public.is_owner())', null);
select pg_temp.leonx_policy('public', 'notifications', 'own_select', 'select', '(select public.is_owner()) and user_id = (select auth.uid())', null);
select pg_temp.leonx_policy('public', 'notifications', 'own_update', 'update', '(select public.is_owner()) and user_id = (select auth.uid())', '(select public.is_owner()) and user_id = (select auth.uid())');
select pg_temp.leonx_policy('public', 'notification_prefs', 'own_select', 'select', '(select public.is_owner()) and user_id = (select auth.uid())', null);
select pg_temp.leonx_policy('public', 'notification_prefs', 'own_insert', 'insert', null, '(select public.is_owner()) and user_id = (select auth.uid())');
select pg_temp.leonx_policy('public', 'notification_prefs', 'own_update', 'update', '(select public.is_owner()) and user_id = (select auth.uid())', '(select public.is_owner()) and user_id = (select auth.uid())');
select pg_temp.leonx_policy('public', 'push_subscriptions', 'own_select', 'select', '(select public.is_owner()) and user_id = (select auth.uid())', null);
select pg_temp.leonx_policy('public', 'push_subscriptions', 'own_update', 'update', '(select public.is_owner()) and user_id = (select auth.uid())', '(select public.is_owner()) and user_id = (select auth.uid())');
select pg_temp.leonx_policy('public', 'push_subscriptions', 'own_delete', 'delete', '(select public.is_owner()) and user_id = (select auth.uid())', null);

-- Realtime: cihazlar arası anlık eşitleme (okundu durumu dahil)
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['project_tasks', 'project_events', 'notifications', 'notification_prefs'] loop
      if not exists (
        select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;
