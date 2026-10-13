-- =====================================================================
-- LEONX OS — 001: Çekirdek şema
--   Tek sahip yapılandırması, firmalar, ilgili kişiler, projeler,
--   durum geçmişi, notlar, dosya kayıtları ve etkinlik günlüğü.
--
-- Bu dosya tekrar çalıştırılabilir (idempotent): hiçbir nesneyi silmez
-- (silme ifadesi içermez), veri değiştirmez; yalnızca eksik nesneleri oluşturur ve
-- fonksiyonları/tetikleyicileri "create or replace" ile günceller.
-- Gereksinim: PostgreSQL 14+ (Supabase: 15/17).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tek sahip (owner) yapılandırması
--   Tabloda en fazla bir satır bulunabilir (singleton). Satır yalnızca
--   Supabase SQL Editor'dan (postgres rolü) eklenir/değiştirilir;
--   uygulama istemcisinin bu tabloya yazma yetkisi yoktur.
-- ---------------------------------------------------------------------
create table if not exists public.app_owner (
  singleton  boolean primary key default true check (singleton),
  user_id    uuid not null unique references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

comment on table public.app_owner is
  'LEONX OS tek yetkili kullanıcısı. Yalnızca SQL Editor üzerinden yönetilir (bkz. supabase/setup/01_set_owner.sql).';

-- Oturumdaki kullanıcının yetkili sahip olup olmadığını döndürür.
-- SECURITY DEFINER: app_owner tablosunu RLS'den bağımsız okur;
-- search_path boş tutularak şema ele geçirme saldırıları engellenir.
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.app_owner o
    where o.user_id = (select auth.uid())
  );
$$;

comment on function public.is_owner() is
  'Oturumdaki kullanıcı (auth.uid()) app_owner tablosundaki tek yetkili kullanıcı mı?';

revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

-- ---------------------------------------------------------------------
-- Ortak tetikleyici fonksiyonları
-- ---------------------------------------------------------------------

-- Ekleme: oluşturan kullanıcıyı sunucu tarafında belirler (istemci değerine güvenilmez).
create or replace function public.tg_set_created_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_by := auth.uid();
  new.created_at := now();
  new.updated_at := now();
  new.version := 1;
  return new;
end;
$$;

-- Güncelleme: updated_at ve version alanlarını sunucu tarafında yönetir.
-- version, iyimser eşzamanlılık (çakışma) kontrolünde kullanılır.
create or replace function public.tg_touch_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.id := old.id;
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Firmalar
-- ---------------------------------------------------------------------
create table if not exists public.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 200),
  phone       text check (phone is null or char_length(phone) <= 40),
  email       text check (email is null or (char_length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  address     text check (address is null or char_length(address) <= 500),
  city        text check (city is null or char_length(city) <= 100),
  tax_office  text check (tax_office is null or char_length(tax_office) <= 120),
  tax_number  text check (tax_number is null or tax_number ~ '^[0-9]{10,11}$'),
  notes       text check (notes is null or char_length(notes) <= 5000),
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  version     integer not null default 1 check (version >= 1)
);

create index if not exists companies_name_idx on public.companies (lower(name));
create index if not exists companies_updated_at_idx on public.companies (updated_at desc);

-- ---------------------------------------------------------------------
-- İlgili kişiler (firmaya bağlı)
-- ---------------------------------------------------------------------
create table if not exists public.contacts (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  full_name   text not null check (char_length(btrim(full_name)) between 1 and 160),
  title       text check (title is null or char_length(title) <= 120),
  phone       text check (phone is null or char_length(phone) <= 40),
  email       text check (email is null or (char_length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  is_primary  boolean not null default false,
  notes       text check (notes is null or char_length(notes) <= 2000),
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  version     integer not null default 1 check (version >= 1)
);

create index if not exists contacts_company_idx on public.contacts (company_id);

-- ---------------------------------------------------------------------
-- Projeler
--   company_id: ON DELETE RESTRICT — projesi olan firma silinemez
--   (yanlışlıkla toplu veri kaybını önler).
-- ---------------------------------------------------------------------
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{1,39}$'),
  name        text not null check (char_length(btrim(name)) between 1 and 200),
  company_id  uuid references public.companies (id) on delete restrict,
  category    text not null check (category in (
                'aluminyum_dograma', 'pvc_dograma', 'celik_kapi', 'oda_kapisi',
                'yangin_kapisi', 'korkuluk', 'cephe', 'metal_imalat', 'diger')),
  status      text not null default 'kesif' check (status in (
                'kesif', 'olcu', 'tasarim', 'teklif', 'uretim', 'montaj',
                'tamamlandi', 'beklemede', 'iptal')),
  priority    text not null default 'normal' check (priority in ('dusuk', 'normal', 'yuksek', 'acil')),
  description text check (description is null or char_length(description) <= 5000),
  start_date  date,
  due_date    date,
  location    text check (location is null or char_length(location) <= 300),
  notes       text check (notes is null or char_length(notes) <= 5000),
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  version     integer not null default 1 check (version >= 1),
  constraint projects_dates_check check (due_date is null or start_date is null or due_date >= start_date)
);

create index if not exists projects_company_idx on public.projects (company_id);
create index if not exists projects_status_idx on public.projects (status);
create index if not exists projects_due_date_idx on public.projects (due_date);
create index if not exists projects_updated_at_idx on public.projects (updated_at desc);

-- ---------------------------------------------------------------------
-- Proje durum geçmişi (yalnızca tetikleyici yazar; istemci okuyabilir)
-- ---------------------------------------------------------------------
create table if not exists public.project_status_history (
  id          bigint generated always as identity primary key,
  project_id  uuid not null references public.projects (id) on delete cascade,
  from_status text,
  to_status   text not null,
  changed_by  uuid,
  changed_at  timestamptz not null default now()
);

create index if not exists project_status_history_project_idx
  on public.project_status_history (project_id, changed_at desc);

-- ---------------------------------------------------------------------
-- Proje notları
-- ---------------------------------------------------------------------
create table if not exists public.project_notes (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  body        text not null check (char_length(btrim(body)) between 1 and 5000),
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  version     integer not null default 1 check (version >= 1)
);

create index if not exists project_notes_project_idx on public.project_notes (project_id, created_at desc);

-- ---------------------------------------------------------------------
-- Proje dosyaları (meta veri). Dosyanın kendisi özel Storage bucket'ında
-- (project-files) "<project_id>/<dosya>" yolunda saklanır.
-- ---------------------------------------------------------------------
create table if not exists public.project_files (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  storage_path text not null unique check (char_length(storage_path) <= 512),
  file_name    text not null check (char_length(btrim(file_name)) between 1 and 255),
  mime_type    text check (mime_type is null or char_length(mime_type) <= 150),
  size_bytes   bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  version      integer not null default 1 check (version >= 1),
  -- Dosya yolu, bağlı olduğu projenin klasöründe olmalıdır
  constraint project_files_path_check check (storage_path like project_id::text || '/%')
);

create index if not exists project_files_project_idx on public.project_files (project_id, created_at desc);

-- ---------------------------------------------------------------------
-- Etkinlik günlüğü (yalnızca tetikleyici yazar; istemci okuyabilir)
-- ---------------------------------------------------------------------
create table if not exists public.activity_log (
  id          bigint generated always as identity primary key,
  entity_type text not null check (entity_type in ('company', 'contact', 'project', 'project_note', 'project_file')),
  entity_id   uuid not null,
  action      text not null check (action in ('insert', 'update', 'delete', 'status_change')),
  summary     text check (summary is null or char_length(summary) <= 500),
  actor       uuid,
  created_at  timestamptz not null default now()
);

create index if not exists activity_log_created_idx on public.activity_log (created_at desc);
create index if not exists activity_log_entity_idx on public.activity_log (entity_type, entity_id);

-- ---------------------------------------------------------------------
-- Tetikleyiciler: created_by / updated_at / version
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['companies', 'contacts', 'projects', 'project_notes', 'project_files'] loop
    execute format('create or replace trigger set_created_by before insert on public.%I for each row execute function public.tg_set_created_by()', t);
    execute format('create or replace trigger touch_row before update on public.%I for each row execute function public.tg_touch_row()', t);
  end loop;
end;
$$;

-- Proje durum geçmişi: ekleme ve durum değişiminde otomatik kayıt.
-- SECURITY DEFINER: istemcinin geçmiş tablosuna doğrudan yazma yetkisi yoktur.
create or replace function public.tg_project_status_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.project_status_history (project_id, from_status, to_status, changed_by)
    values (new.id, null, new.status, auth.uid());
  elsif new.status is distinct from old.status then
    insert into public.project_status_history (project_id, from_status, to_status, changed_by)
    values (new.id, old.status, new.status, auth.uid());
  end if;
  return null;
end;
$$;

create or replace trigger project_status_history
  after insert or update of status on public.projects
  for each row execute function public.tg_project_status_history();

-- Etkinlik günlüğü: tüm iş tablolarındaki değişiklikler.
-- Satır JSON'a çevrilerek okunur; böylece aynı fonksiyon farklı sütunlara
-- sahip tablolarda güvenle çalışır.
create or replace function public.tg_activity_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row     jsonb;
  v_old     jsonb;
  v_type    text := tg_argv[0];
  v_action  text := lower(tg_op);
  v_summary text;
begin
  if tg_op = 'DELETE' then
    v_row := to_jsonb(old);
  else
    v_row := to_jsonb(new);
  end if;

  if tg_op = 'UPDATE' and tg_table_name = 'projects' then
    v_old := to_jsonb(old);
    if (v_row ->> 'status') is distinct from (v_old ->> 'status') then
      v_action := 'status_change';
    end if;
  end if;

  v_summary := case tg_table_name
    when 'companies' then v_row ->> 'name'
    when 'contacts' then v_row ->> 'full_name'
    when 'projects' then (v_row ->> 'code') || ' · ' || (v_row ->> 'name')
    when 'project_files' then v_row ->> 'file_name'
    else null
  end;

  insert into public.activity_log (entity_type, entity_id, action, summary, actor)
  values (v_type, (v_row ->> 'id')::uuid, v_action, left(v_summary, 500), auth.uid());
  return null;
end;
$$;

do $$
declare
  pair text[];
begin
  foreach pair slice 1 in array array[
    array['companies', 'company'],
    array['contacts', 'contact'],
    array['projects', 'project'],
    array['project_notes', 'project_note'],
    array['project_files', 'project_file']
  ] loop
    execute format(
      'create or replace trigger activity_log after insert or update or delete on public.%I for each row execute function public.tg_activity_log(%L)',
      pair[1], pair[2]);
  end loop;
end;
$$;

-- Bu yıl için sıradaki önerilen proje kodu: LX-YYYY-NNN (yalnızca öneri; benzersizlik tablo kısıtıyla korunur)
create or replace function public.suggest_project_code()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select 'LX-' || to_char(now(), 'YYYY') || '-' || lpad((coalesce(max(
           nullif(substring(p.code from '^LX-' || to_char(now(), 'YYYY') || '-([0-9]+)$'), '')::int
         ), 0) + 1)::text, 3, '0')
  from public.projects p;
$$;

revoke all on function public.suggest_project_code() from public, anon;
grant execute on function public.suggest_project_code() to authenticated;

-- Tetikleyici fonksiyonları doğrudan çağrılamaz; yine de API rollerinden yetki kaldırılır.
revoke all on function public.tg_set_created_by() from public, anon;
revoke all on function public.tg_touch_row() from public, anon;
revoke all on function public.tg_project_status_history() from public, anon;
revoke all on function public.tg_activity_log() from public, anon;
