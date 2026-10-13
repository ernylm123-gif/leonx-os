-- =====================================================================
-- LEONX OS — 005: CAD analizleri ve poz bazlı metraj
--
-- Tablolar
--   cad_analyses           Bir projeye bağlı CAD/PDF analiz kayıtları (özet; geometri saklanmaz)
--   quantity_takeoffs      Metraj sürümleri (revizyon). Onaylanan sürüm kilitlenir.
--   quantity_items         Poz satırları (ölçü, adet, doğrulama durumu, çizim referansı)
--   quantity_item_history  Poz satırlarındaki her değişikliğin alan bazlı kaydı (yalnız okunur)
--
-- Güvenlik: tüm tablolarda RLS açık; erişim yalnızca public.is_owner() ile. anon hiçbir yetkiye
-- sahip değildir. Geçmiş tablosuna yalnızca SECURITY DEFINER tetikleyici yazar.
--
-- Silme ilişkileri
--   Proje silinir  → analizler, metraj sürümleri, pozlar ve geçmiş zincirleme silinir.
--   Dosya silinir  → analiz kaydı korunur, dosya bağlantısı boşaltılır (file_id = null).
--   Analiz silinir → metraj sürümü ve pozlar korunur (analysis_id = null).
--   Onaylı sürüm   → doğrudan silinemez/değiştirilemez (proje silinirse zincirleme silinir).
--
-- Tekrar çalıştırılabilir; DROP veya veri silme içermez.
-- =====================================================================

-- ---------------------------------------------------------------------
-- CAD analizleri
-- ---------------------------------------------------------------------
create table if not exists public.cad_analyses (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects (id) on delete cascade,
  file_id           uuid references public.project_files (id) on delete set null,
  file_name         text not null check (char_length(btrim(file_name)) between 1 and 255),
  file_kind         text not null check (file_kind in ('dxf', 'pdf')),
  status            text not null default 'tamamlandi' check (status in ('tamamlandi', 'eksik', 'hatali')),
  units_mm_per_unit numeric(18, 9) check (units_mm_per_unit is null or units_mm_per_unit > 0),
  units_source      text not null default 'yok' check (units_source in ('dosya', 'kullanici', 'kalibrasyon', 'olcek', 'yok')),
  units_verified    boolean not null default false,
  entity_count      integer not null default 0 check (entity_count >= 0),
  warning_count     integer not null default 0 check (warning_count >= 0),
  candidate_count   integer not null default 0 check (candidate_count >= 0),
  engine_version    text not null check (char_length(engine_version) between 1 and 40),
  summary           jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object' and pg_column_size(summary) <= 262144),
  notes             text check (notes is null or char_length(notes) <= 2000),
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  version           integer not null default 1 check (version >= 1)
);
create index if not exists cad_analyses_project_idx on public.cad_analyses (project_id, created_at desc);
create index if not exists cad_analyses_file_idx on public.cad_analyses (file_id);

-- ---------------------------------------------------------------------
-- Metraj sürümleri
-- ---------------------------------------------------------------------
create table if not exists public.quantity_takeoffs (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 120),
  revision    integer not null check (revision between 1 and 9999),
  status      text not null default 'taslak' check (status in ('taslak', 'onaylandi', 'arsiv')),
  based_on    uuid references public.quantity_takeoffs (id) on delete set null,
  analysis_id uuid references public.cad_analyses (id) on delete set null,
  notes       text check (notes is null or char_length(notes) <= 2000),
  approved_at timestamptz,
  approved_by uuid,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  version     integer not null default 1 check (version >= 1),
  constraint quantity_takeoffs_revision_unique unique (project_id, revision),
  constraint quantity_takeoffs_approval_check check (status = 'taslak' or approved_at is not null or status = 'arsiv')
);
create index if not exists quantity_takeoffs_project_idx on public.quantity_takeoffs (project_id, revision desc);

-- ---------------------------------------------------------------------
-- Poz satırları
-- ---------------------------------------------------------------------
create table if not exists public.quantity_items (
  id                  uuid primary key default gen_random_uuid(),
  takeoff_id          uuid not null references public.quantity_takeoffs (id) on delete cascade,
  project_id          uuid not null references public.projects (id) on delete cascade,
  poz_code            text not null check (char_length(btrim(poz_code)) between 1 and 40),
  category            text not null check (category in (
                        'al_pencere', 'al_kapi', 'pvc_pencere', 'pvc_kapi', 'surme', 'sabit_cam', 'cephe_dograma',
                        'fotoselli_kapi', 'korkuluk', 'kompozit_cephe', 'metal_imalat', 'belirsiz')),
  floor               text check (floor is null or char_length(floor) <= 80),
  space               text check (space is null or char_length(space) <= 80),
  shape               text not null default 'dikdortgen' check (shape in ('dikdortgen', 'ucgen', 'yamuk', 'kemerli', 'daire', 'cokgen', 'manuel')),
  width_mm            numeric(9, 1) check (width_mm is null or (width_mm > 0 and width_mm <= 100000)),
  height_mm           numeric(9, 1) check (height_mm is null or (height_mm > 0 and height_mm <= 100000)),
  height2_mm          numeric(9, 1) check (height2_mm is null or (height2_mm > 0 and height2_mm <= 100000)),
  apex_mm             numeric(9, 1) check (apex_mm is null or (apex_mm >= 0 and apex_mm <= 100000)),
  rise_mm             numeric(9, 1) check (rise_mm is null or (rise_mm > 0 and rise_mm <= 100000)),
  vertices            jsonb check (vertices is null or (jsonb_typeof(vertices) = 'array' and jsonb_array_length(vertices) between 3 and 500)),
  manual_area_m2      numeric(12, 3) check (manual_area_m2 is null or (manual_area_m2 > 0 and manual_area_m2 <= 10000)),
  manual_perimeter_m  numeric(12, 3) check (manual_perimeter_m is null or manual_perimeter_m >= 0),
  manual_quantity     numeric(12, 3) check (manual_quantity is null or manual_quantity > 0),
  quantity            integer not null default 1 check (quantity between 1 and 100000),
  unit                text not null default 'm2' check (unit in ('m2', 'mtul', 'adet', 'kg')),
  measure_basis       text not null default 'dograma' check (measure_basis in ('dograma', 'bosluk')),
  install_gap_mm      numeric(7, 1) check (install_gap_mm is null or install_gap_mm >= 0),
  glass_mode          text not null default 'yok' check (glass_mode in ('yok', 'dusum', 'manuel')),
  glass_deduction_mm  numeric(7, 1) check (glass_deduction_mm is null or glass_deduction_mm >= 0),
  glass_manual_m2     numeric(12, 3) check (glass_manual_m2 is null or glass_manual_m2 > 0),
  description         text check (description is null or char_length(description) <= 1000),
  drawing_ref         jsonb check (drawing_ref is null or (jsonb_typeof(drawing_ref) = 'object' and pg_column_size(drawing_ref) <= 65536)),
  detection           jsonb check (detection is null or (jsonb_typeof(detection) = 'object' and pg_column_size(detection) <= 16384)),
  verification        text not null default 'bekliyor' check (verification in ('bekliyor', 'onaylandi', 'reddedildi')),
  sort_order          integer not null default 0,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  version             integer not null default 1 check (version >= 1)
);
create index if not exists quantity_items_takeoff_idx on public.quantity_items (takeoff_id, sort_order, poz_code);
create index if not exists quantity_items_project_idx on public.quantity_items (project_id);

-- ---------------------------------------------------------------------
-- Poz değişiklik geçmişi (manuel düzeltme kaydı)
-- ---------------------------------------------------------------------
create table if not exists public.quantity_item_history (
  id          bigint generated always as identity primary key,
  item_id     uuid not null,
  takeoff_id  uuid not null,
  project_id  uuid not null references public.projects (id) on delete cascade,
  poz_code    text,
  action      text not null check (action in ('ekle', 'guncelle', 'sil')),
  changes     jsonb not null default '{}'::jsonb,
  changed_by  uuid,
  changed_at  timestamptz not null default now()
);
create index if not exists quantity_item_history_item_idx on public.quantity_item_history (item_id, changed_at desc);
create index if not exists quantity_item_history_takeoff_idx on public.quantity_item_history (takeoff_id, changed_at desc);

-- ---------------------------------------------------------------------
-- Ortak tetikleyiciler: created_by / updated_at / version
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['cad_analyses', 'quantity_takeoffs', 'quantity_items'] loop
    execute format('create or replace trigger set_created_by before insert on public.%I for each row execute function public.tg_set_created_by()', t);
    execute format('create or replace trigger touch_row before update on public.%I for each row execute function public.tg_touch_row()', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- Bütünlük: poz satırı, bağlı olduğu sürümün projesinde olmalı; onaylı/arşiv sürüm kilitlidir.
-- pg_trigger_depth() > 1: proje silinirken zincirleme silme (izinli).
-- ---------------------------------------------------------------------
create or replace function public.tg_quantity_item_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status  text;
  v_project uuid;
begin
  if tg_op = 'DELETE' then
    select status into v_status from public.quantity_takeoffs where id = old.takeoff_id;
    if v_status is not null and v_status <> 'taslak' and pg_trigger_depth() = 1 then
      raise exception 'Onaylanmış veya arşivlenmiş metraj sürümündeki poz silinemez' using errcode = 'check_violation';
    end if;
    return old;
  end if;
  select status, project_id into v_status, v_project from public.quantity_takeoffs where id = new.takeoff_id;
  if v_project is null then
    raise exception 'Metraj sürümü bulunamadı' using errcode = 'foreign_key_violation';
  end if;
  if v_status <> 'taslak' then
    raise exception 'Onaylanmış veya arşivlenmiş metraj sürümü değiştirilemez; yeni sürüm oluşturun' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and new.takeoff_id is distinct from old.takeoff_id then
    raise exception 'Poz başka bir metraj sürümüne taşınamaz' using errcode = 'check_violation';
  end if;
  -- project_id her zaman sürümün projesidir (istemci değeri yok sayılır)
  new.project_id := v_project;
  return new;
end;
$$;

create or replace trigger quantity_item_guard
  before insert or update or delete on public.quantity_items
  for each row execute function public.tg_quantity_item_guard();

create or replace function public.tg_quantity_takeoff_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'onaylandi' and pg_trigger_depth() = 1 then
      raise exception 'Onaylanmış metraj sürümü silinemez; arşivleyebilirsiniz' using errcode = 'check_violation';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if new.project_id is distinct from old.project_id then
      raise exception 'Metraj sürümü başka projeye taşınamaz' using errcode = 'check_violation';
    end if;
    if old.status = 'onaylandi' then
      -- Onaylı sürümde yalnızca arşive alma ve not güncellemesi yapılabilir
      if new.status not in ('onaylandi', 'arsiv') or new.name is distinct from old.name or new.revision is distinct from old.revision then
        raise exception 'Onaylanmış metraj sürümü değiştirilemez; yeni sürüm oluşturun' using errcode = 'check_violation';
      end if;
    end if;
    if old.status = 'arsiv' and new.status <> 'arsiv' then
      raise exception 'Arşivlenmiş sürüm yeniden açılamaz; yeni sürüm oluşturun' using errcode = 'check_violation';
    end if;
    if new.status = 'onaylandi' and old.status = 'taslak' then
      new.approved_at := now();
      new.approved_by := auth.uid();
    end if;
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'taslak' then
      raise exception 'Yeni metraj sürümü taslak olarak oluşturulur' using errcode = 'check_violation';
    end if;
    new.approved_at := null;
    new.approved_by := null;
  end if;
  return new;
end;
$$;

create or replace trigger quantity_takeoff_guard
  before insert or update or delete on public.quantity_takeoffs
  for each row execute function public.tg_quantity_takeoff_guard();

-- ---------------------------------------------------------------------
-- Değişiklik geçmişi (alan bazlı). SECURITY DEFINER: istemci geçmişe doğrudan yazamaz.
-- Proje silinirken kayıt tutulmaz; geçmiş de proje ile birlikte silinir.
-- ---------------------------------------------------------------------
create or replace function public.tg_quantity_item_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changes jsonb;
begin
  -- Proje silinirken (zincirleme silme) geçmiş yazılmaz: proje satırı artık görünmez.
  -- (AFTER tetikleyicilerinde pg_trigger_depth() zincirleme silmeyi güvenilir biçimde ayırt etmez.)
  if tg_op = 'DELETE' and not exists (select 1 from public.projects where id = old.project_id) then
    return null;
  end if;
  if tg_op = 'INSERT' then
    insert into public.quantity_item_history (item_id, takeoff_id, project_id, poz_code, action, changes, changed_by)
    values (new.id, new.takeoff_id, new.project_id, new.poz_code, 'ekle', '{}'::jsonb, auth.uid());
  elsif tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(n.key, jsonb_build_object('eski', o.value, 'yeni', n.value)), '{}'::jsonb)
      into v_changes
      from jsonb_each(to_jsonb(new)) n
      join jsonb_each(to_jsonb(old)) o using (key)
     where n.value is distinct from o.value
       and n.key not in ('updated_at', 'version', 'created_at', 'created_by');
    if v_changes <> '{}'::jsonb then
      insert into public.quantity_item_history (item_id, takeoff_id, project_id, poz_code, action, changes, changed_by)
      values (new.id, new.takeoff_id, new.project_id, new.poz_code, 'guncelle', v_changes, auth.uid());
    end if;
  else
    insert into public.quantity_item_history (item_id, takeoff_id, project_id, poz_code, action, changes, changed_by)
    values (old.id, old.takeoff_id, old.project_id, old.poz_code, 'sil', '{}'::jsonb, auth.uid());
  end if;
  return null;
end;
$$;

create or replace trigger quantity_item_history
  after insert or update or delete on public.quantity_items
  for each row execute function public.tg_quantity_item_history();

-- ---------------------------------------------------------------------
-- Yeni metraj sürümü: kaynak sürümün pozlarını kopyalar. SECURITY INVOKER (RLS geçerlidir).
-- ---------------------------------------------------------------------
create or replace function public.create_takeoff_revision(p_source uuid, p_name text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_project  uuid;
  v_revision integer;
  v_new      uuid;
  v_analysis uuid;
begin
  select project_id, analysis_id into v_project, v_analysis from public.quantity_takeoffs where id = p_source;
  if v_project is null then
    raise exception 'Kaynak metraj sürümü bulunamadı' using errcode = 'no_data_found';
  end if;
  select coalesce(max(revision), 0) + 1 into v_revision from public.quantity_takeoffs where project_id = v_project;
  insert into public.quantity_takeoffs (project_id, name, revision, status, based_on, analysis_id)
  values (v_project, left(coalesce(nullif(btrim(p_name), ''), 'Metraj'), 120), v_revision, 'taslak', p_source, v_analysis)
  returning id into v_new;
  insert into public.quantity_items (
    takeoff_id, project_id, poz_code, category, floor, space, shape, width_mm, height_mm, height2_mm, apex_mm, rise_mm,
    vertices, manual_area_m2, manual_perimeter_m, manual_quantity, quantity, unit, measure_basis, install_gap_mm,
    glass_mode, glass_deduction_mm, glass_manual_m2, description, drawing_ref, detection, verification, sort_order)
  select v_new, v_project, poz_code, category, floor, space, shape, width_mm, height_mm, height2_mm, apex_mm, rise_mm,
         vertices, manual_area_m2, manual_perimeter_m, manual_quantity, quantity, unit, measure_basis, install_gap_mm,
         glass_mode, glass_deduction_mm, glass_manual_m2, description, drawing_ref, detection, verification, sort_order
    from public.quantity_items
   where takeoff_id = p_source;
  return v_new;
end;
$$;

-- Projedeki sıradaki revizyon numarası (yalnızca öneri; benzersizlik kısıtla korunur)
create or replace function public.next_takeoff_revision(p_project uuid)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(max(revision), 0) + 1 from public.quantity_takeoffs where project_id = p_project;
$$;

revoke all on function public.tg_quantity_item_guard() from public, anon;
revoke all on function public.tg_quantity_takeoff_guard() from public, anon;
revoke all on function public.tg_quantity_item_history() from public, anon;
revoke all on function public.create_takeoff_revision(uuid, text) from public, anon;
revoke all on function public.next_takeoff_revision(uuid) from public, anon;
grant execute on function public.create_takeoff_revision(uuid, text) to authenticated;
grant execute on function public.next_takeoff_revision(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Yetkiler ve RLS
-- ---------------------------------------------------------------------
revoke all on table public.cad_analyses, public.quantity_takeoffs, public.quantity_items, public.quantity_item_history from anon;
revoke all on table public.cad_analyses, public.quantity_takeoffs, public.quantity_items, public.quantity_item_history from authenticated;
grant select, insert, update, delete on table public.cad_analyses, public.quantity_takeoffs, public.quantity_items to authenticated;
grant select on table public.quantity_item_history to authenticated;

alter table public.cad_analyses          enable row level security;
alter table public.quantity_takeoffs     enable row level security;
alter table public.quantity_items        enable row level security;
alter table public.quantity_item_history enable row level security;

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

do $$
declare
  t text;
begin
  foreach t in array array['cad_analyses', 'quantity_takeoffs', 'quantity_items'] loop
    perform pg_temp.leonx_policy('public', t, 'owner_select', 'select', '(select public.is_owner())', null);
    perform pg_temp.leonx_policy('public', t, 'owner_insert', 'insert', null, '(select public.is_owner())');
    perform pg_temp.leonx_policy('public', t, 'owner_update', 'update', '(select public.is_owner())', '(select public.is_owner())');
    perform pg_temp.leonx_policy('public', t, 'owner_delete', 'delete', '(select public.is_owner())', null);
  end loop;
end;
$$;
select pg_temp.leonx_policy('public', 'quantity_item_history', 'owner_select', 'select', '(select public.is_owner())', null);

-- ---------------------------------------------------------------------
-- Realtime: metraj ve analiz değişiklikleri diğer cihazlara yansır
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['cad_analyses', 'quantity_takeoffs', 'quantity_items'] loop
      if not exists (
        select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;
