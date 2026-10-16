-- =====================================================================
-- LEONX OS — 014: Malzeme reçetesi (BOM) — ürün sistemleri ve onaylı metrajdan malzeme ihtiyacı
--
-- Tablolar
--   product_systems    Kullanıcının tanımladığı ürün sistemleri (üretici, seri, tip). Kütüphane BOŞ başlar;
--                      sistem üretici verisi (profil kodu, ağırlık, fiyat, kesim düşümü) UYDURMAZ.
--   system_components  Sistemin bileşenleri: kasa/kanat/kayıt profili, cam, fitil, aksesuar… (kod, birim,
--                      standart boy, fire, kg/m, mevcut birim maliyet kataloğuna bağlantı — fiyat kopyalanmaz)
--   system_rules       Bileşenin üretim kuralı: miktar, kesim boyu ve parça formülleri (metin; istemci doğrular,
--                      veritabanı uzunluk ve karakter kümesi denetler)
--   bom_versions       Reçete sürümü (proje başına revizyon numarası). Onaylanan sürüm DEĞİŞTİRİLEMEZ.
--   bom_assignments    Sürümdeki poz → sistem ataması ve poz ölçülerinin anlık görüntüsü
--   bom_lines          Hesaplanan malzeme satırları (bileşen ve maliyet anlık görüntüsüyle)
-- Görünümler (security_invoker: RLS geçerli)
--   bom_material_totals  Sürüm başına bileşen kodu + birim toplamları ve standart boy adedi tahmini
--   bom_cut_list         Sürüm başına profil kodu × kesim boyu × açı parça listesi (kesim optimizasyonu girdisi)
--
-- Kurallar (veritabanında uygulanır, istemciye güvenilmez)
--   • Sürüm, assignment ve satırlar yalnız create_bom_version() ile tek işlemde yazılır (yarım sürüm olmaz);
--     revizyon numarası proje başına kilitle atanır (benzersiz).
--   • source_approved sunucuda hesaplanır: metraj sürümü onaylı VE sürümdeki tüm pozlar onaylı (belirsiz değil).
--     Onaysız metrajdan oluşturulan sürüm "taslak" kalır ve onaylanamaz (011 finans kuralıyla aynı).
--   • Onaylı sürüm ve satırları güncellenemez/silinemez (proje silinirse zincirleme silinir).
--
-- Güvenlik: tüm tablolarda RLS açık; erişim yalnızca public.is_owner(). anon hiçbir yetkiye sahip değil.
-- Tekrar çalıştırılabilir; nesne kaldırma veya veri silme ifadesi içermez. Mevcut veriye dokunmaz.
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

-- =====================================================================
-- A) ÜRÜN SİSTEMLERİ (kütüphane)
-- =====================================================================
create table if not exists public.product_systems (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(btrim(name)) between 1 and 120),
  manufacturer text check (manufacturer is null or char_length(manufacturer) <= 120),
  series       text check (series is null or char_length(series) <= 120),
  -- Metraj iş gruplarıyla hizalı (src/quantity/types.ts); toplu atamada öneri için kullanılır
  system_type  text not null default 'diger' check (system_type in (
                 'al_pencere', 'al_kapi', 'pvc_pencere', 'pvc_kapi', 'surme', 'cephe', 'korkuluk', 'metal_imalat', 'diger')),
  color        text check (color is null or char_length(color) <= 80),
  notes        text check (notes is null or char_length(notes) <= 2000),
  active       boolean not null default true,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  version      integer not null default 1 check (version >= 1)
);
create index if not exists product_systems_type_idx on public.product_systems (system_type, name);

create table if not exists public.system_components (
  id                 uuid primary key default gen_random_uuid(),
  system_id          uuid not null references public.product_systems (id) on delete cascade,
  role               text not null check (role in (
                       'kasa', 'kanat', 'kayit', 'orta_kayit', 'pervaz', 'cam', 'fitil', 'mentese', 'kol', 'kilit',
                       'baglanti', 'montaj', 'aksesuar', 'diger')),
  -- Profil / ürün kodu: kullanıcı üretici kataloğundan girer (boş şablonda boştur)
  code               text check (code is null or char_length(btrim(code)) between 1 and 60),
  name               text not null check (char_length(btrim(name)) between 1 and 200),
  -- mm_profil: kesimli profil (kesim boyu mm × parça); miktar toplam metre olarak hesaplanır
  unit               text not null check (unit in ('mm_profil', 'm', 'm2', 'adet', 'kg', 'takim')),
  standard_length_mm integer check (standard_length_mm is null or standard_length_mm between 1 and 20000),
  waste_pct          numeric(7, 3) not null default 0 check (waste_pct between 0 and 100),
  weight_kg_per_m    numeric(10, 3) check (weight_kg_per_m is null or (weight_kg_per_m > 0 and weight_kg_per_m <= 1000)),
  -- Mevcut birim maliyet kataloğuna bağlantı (011); fiyat burada saklanmaz
  cost_rate_id       uuid references public.cost_rates (id) on delete set null,
  sort_order         integer not null default 0,
  notes              text check (notes is null or char_length(notes) <= 2000),
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  version            integer not null default 1 check (version >= 1),
  constraint system_components_profile_check check (unit = 'mm_profil' or (standard_length_mm is null and weight_kg_per_m is null))
);
create index if not exists system_components_system_idx on public.system_components (system_id, sort_order);

create table if not exists public.system_rules (
  id                 uuid primary key default gen_random_uuid(),
  component_id       uuid not null references public.system_components (id) on delete cascade,
  -- Boş: her poza uygulanır. Dolu: poz iş grubu (ör. al_pencere) veya açılım metni bunu içeriyorsa
  applies_to         text check (applies_to is null or char_length(btrim(applies_to)) between 1 and 80),
  -- birim: formül tek ürün (1 adet poz) içindir, sonuç N ile çarpılır · poz: formül pozun toplamıdır (N'yi kendisi kullanır)
  basis              text not null default 'birim' check (basis in ('birim', 'poz')),
  quantity_formula   text check (quantity_formula is null or (char_length(quantity_formula) between 1 and 500 and quantity_formula ~ '^[0-9A-Za-z_+*/(). ,;-]+$')),
  cut_length_formula text check (cut_length_formula is null or (char_length(cut_length_formula) between 1 and 500 and cut_length_formula ~ '^[0-9A-Za-z_+*/(). ,;-]+$')),
  pieces_formula     text check (pieces_formula is null or (char_length(pieces_formula) between 1 and 500 and pieces_formula ~ '^[0-9A-Za-z_+*/(). ,;-]+$')),
  -- Bilgi amaçlı kesim açısı ('90', '45', '45/90' …)
  angle              text check (angle is null or char_length(angle) <= 20),
  notes              text check (notes is null or char_length(notes) <= 1000),
  sort_order         integer not null default 0,
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  version            integer not null default 1 check (version >= 1),
  constraint system_rules_formula_check check (quantity_formula is not null or cut_length_formula is not null or pieces_formula is not null)
);
create index if not exists system_rules_component_idx on public.system_rules (component_id, sort_order);

-- =====================================================================
-- B) REÇETE SÜRÜMLERİ, ATAMALAR VE SATIRLAR
-- =====================================================================
create table if not exists public.bom_versions (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects (id) on delete cascade,
  takeoff_id       uuid references public.quantity_takeoffs (id) on delete set null,
  -- Metraj sürümünün anlık görüntüsü (sunucu yazar)
  takeoff_revision integer not null check (takeoff_revision between 1 and 9999),
  takeoff_name     text not null,
  takeoff_status   text not null check (takeoff_status in ('taslak', 'onaylandi', 'arsiv')),
  revision         integer not null check (revision between 1 and 9999),
  status           text not null default 'taslak' check (status in ('taslak', 'onayli', 'iptal')),
  -- Sunucu hesaplar: metraj onaylı VE tüm pozlar onaylı. false → "onaysız metrajdan — taslak", onaylanamaz
  source_approved  boolean not null default false,
  error_count      integer not null default 0 check (error_count >= 0),
  warning_count    integer not null default 0 check (warning_count >= 0),
  warnings         jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array' and pg_column_size(warnings) <= 262144),
  engine_version   text not null default 'bom-1' check (char_length(engine_version) between 1 and 40),
  based_on         uuid references public.bom_versions (id) on delete set null,
  notes            text check (notes is null or char_length(notes) <= 2000),
  approved_by      uuid,
  approved_at      timestamptz,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  version          integer not null default 1 check (version >= 1),
  constraint bom_versions_revision_unique unique (project_id, revision),
  constraint bom_versions_approval_check check (status <> 'onayli' or (approved_at is not null and source_approved))
);
create index if not exists bom_versions_project_idx on public.bom_versions (project_id, revision desc);
create index if not exists bom_versions_takeoff_idx on public.bom_versions (takeoff_id);

create table if not exists public.bom_assignments (
  id               uuid primary key default gen_random_uuid(),
  bom_version_id   uuid not null references public.bom_versions (id) on delete cascade,
  quantity_item_id uuid references public.quantity_items (id) on delete set null,
  -- Poz anlık görüntüsü (metraj sonradan değişse de sürüm aynı kalır)
  poz_code         text not null check (char_length(btrim(poz_code)) between 1 and 40),
  category         text not null check (char_length(category) between 1 and 40),
  width_mm         numeric(9, 1) check (width_mm is null or width_mm > 0),
  height_mm        numeric(9, 1) check (height_mm is null or height_mm > 0),
  quantity         integer not null check (quantity between 1 and 100000),
  verification     text not null check (verification in ('bekliyor', 'onaylandi', 'reddedildi')),
  kanat            integer check (kanat is null or kanat between 1 and 50),
  opening          text check (opening is null or char_length(opening) <= 200),
  system_id        uuid references public.product_systems (id) on delete set null,
  system_name      text check (system_name is null or char_length(system_name) <= 200),
  sort_order       integer not null default 0
);
create index if not exists bom_assignments_version_idx on public.bom_assignments (bom_version_id, sort_order);
create index if not exists bom_assignments_item_idx on public.bom_assignments (quantity_item_id);

create table if not exists public.bom_lines (
  id                 uuid primary key default gen_random_uuid(),
  bom_version_id     uuid not null references public.bom_versions (id) on delete cascade,
  assignment_id      uuid references public.bom_assignments (id) on delete cascade,
  component_id       uuid references public.system_components (id) on delete set null,
  rule_id            uuid references public.system_rules (id) on delete set null,
  -- Sürümler arası karşılaştırma anahtarı (poz | kod | rol | birim | kural sırası)
  line_key           text not null check (char_length(line_key) between 1 and 300),
  poz_code           text check (poz_code is null or char_length(poz_code) <= 40),
  -- Bileşen anlık görüntüsü
  role               text not null check (role in (
                       'kasa', 'kanat', 'kayit', 'orta_kayit', 'pervaz', 'cam', 'fitil', 'mentese', 'kol', 'kilit',
                       'baglanti', 'montaj', 'aksesuar', 'diger')),
  code               text check (code is null or char_length(code) <= 60),
  name               text not null check (char_length(name) between 1 and 200),
  unit               text not null check (unit in ('mm_profil', 'm', 'm2', 'adet', 'kg', 'takim')),
  -- Profil: tek parça kesim boyu ve toplam parça; miktar (quantity) toplam METRE'dir
  cut_length_mm      numeric(10, 1) check (cut_length_mm is null or cut_length_mm > 0),
  angle              text check (angle is null or char_length(angle) <= 20),
  pieces             numeric(14, 3) check (pieces is null or pieces > 0),
  total_length_mm    numeric(14, 1) check (total_length_mm is null or total_length_mm > 0),
  net_quantity       numeric(14, 3) not null check (net_quantity > 0),
  waste_pct          numeric(7, 3) not null default 0 check (waste_pct between 0 and 100),
  waste_qty          numeric(14, 3) not null default 0 check (waste_qty >= 0),
  quantity           numeric(14, 3) not null check (quantity > 0),
  standard_length_mm integer check (standard_length_mm is null or standard_length_mm > 0),
  weight_kg          numeric(14, 3) check (weight_kg is null or weight_kg >= 0),
  -- Maliyet anlık görüntüsü: katalogda yoksa BOŞ ("fiyat tanımlı değil"); sıfır varsayılmaz
  cost_rate_id       uuid references public.cost_rates (id) on delete set null,
  unit_cost          numeric(14, 2) check (unit_cost is null or unit_cost >= 0),
  currency           text check (currency is null or currency in ('TRY', 'EUR', 'USD')),
  cost_unit          text check (cost_unit is null or cost_unit in ('m2', 'mtul', 'adet', 'kg', 'saat', 'goturu', 'm')),
  line_cost          numeric(14, 2) check (line_cost is null or line_cost >= 0),
  sort_order         integer not null default 0,
  constraint bom_lines_cost_check check ((unit_cost is null) = (currency is null) and (unit_cost is null) = (line_cost is null)),
  constraint bom_lines_profile_check check (unit <> 'mm_profil' or (cut_length_mm is not null and pieces is not null and total_length_mm is not null))
);
create index if not exists bom_lines_version_idx on public.bom_lines (bom_version_id, sort_order);
create index if not exists bom_lines_assignment_idx on public.bom_lines (assignment_id);

-- ---------------------------------------------------------------------
-- Ortak tetikleyiciler: created_by / updated_at / version
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['product_systems', 'system_components', 'system_rules', 'bom_versions'] loop
    execute format('create or replace trigger set_created_by before insert on public.%I for each row execute function public.tg_set_created_by()', t);
    execute format('create or replace trigger touch_row before update on public.%I for each row execute function public.tg_touch_row()', t);
  end loop;
end;
$$;

-- =====================================================================
-- C) BÜTÜNLÜK KURALLARI
-- =====================================================================

-- Sürüm: onaylı sürüm kilitli; onay yalnız onaylı metrajdan; sunucu alanları istemciden yazılamaz.
-- pg_trigger_depth() > 1: zincirleme silme / yabancı anahtar boşaltma (proje veya metraj silinirken) izinli.
create or replace function public.tg_bom_version_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    if old.status = 'onayli' then
      raise exception 'Onaylanmış reçete sürümü silinemez' using errcode = 'check_violation';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'taslak' then
      raise exception 'Yeni reçete sürümü taslak olarak oluşturulur' using errcode = 'check_violation';
    end if;
    new.approved_at := null;
    new.approved_by := null;
    -- Onaylı kaynak bilgisini yalnız create_bom_version() yazar (pozları metraj tablosundan doğrulayarak)
    if coalesce(current_setting('leonx.bom_internal', true), '') <> 'on' then
      new.source_approved := false;
    end if;
    return new;
  end if;
  -- UPDATE
  if old.status = 'onayli' then
    raise exception 'Onaylanmış reçete sürümü değiştirilemez; yeniden hesaplayıp yeni sürüm oluşturun' using errcode = 'check_violation';
  end if;
  if old.status = 'iptal' and new.status <> 'iptal' then
    raise exception 'İptal edilen reçete sürümü yeniden açılamaz' using errcode = 'check_violation';
  end if;
  -- Sunucunun yazdığı alanlar ve içerik değiştirilemez (yalnız durum ve not)
  if new.project_id is distinct from old.project_id or new.takeoff_id is distinct from old.takeoff_id
     or new.revision is distinct from old.revision or new.source_approved is distinct from old.source_approved
     or new.takeoff_revision is distinct from old.takeoff_revision or new.takeoff_status is distinct from old.takeoff_status
     or new.takeoff_name is distinct from old.takeoff_name or new.error_count is distinct from old.error_count
     or new.warning_count is distinct from old.warning_count or new.warnings is distinct from old.warnings
     or new.engine_version is distinct from old.engine_version or new.based_on is distinct from old.based_on then
    raise exception 'Reçete sürümünün hesap içeriği değiştirilemez; yeniden hesaplayın' using errcode = 'check_violation';
  end if;
  if new.status = 'onayli' and old.status = 'taslak' then
    if not old.source_approved then
      raise exception 'Onaysız metrajdan oluşturulan reçete onaylanamaz; önce metrajı ve pozları onaylayın' using errcode = 'check_violation';
    end if;
    if old.error_count > 0 then
      raise exception 'Hatalı satırı olan reçete onaylanamaz (% hata)', old.error_count using errcode = 'check_violation';
    end if;
    new.approved_at := now();
    new.approved_by := auth.uid();
  else
    new.approved_at := old.approved_at;
    new.approved_by := old.approved_by;
  end if;
  return new;
end;
$$;
create or replace trigger bom_version_guard
  before insert or update or delete on public.bom_versions
  for each row execute function public.tg_bom_version_guard();

-- Atama ve satırlar: yalnız taslak sürümde eklenir; onaylı/iptal sürümde değişmez, silinmez.
create or replace function public.tg_bom_child_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  if pg_trigger_depth() > 1 then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'Reçete satırları değiştirilemez; yeniden hesaplayıp yeni sürüm oluşturun' using errcode = 'check_violation';
  end if;
  select status into v_status from public.bom_versions
   where id = case when tg_op = 'DELETE' then old.bom_version_id else new.bom_version_id end;
  if tg_op = 'DELETE' then
    if v_status = 'onayli' then
      raise exception 'Onaylanmış reçete sürümünün satırları silinemez' using errcode = 'check_violation';
    end if;
    return old;
  end if;
  if v_status is distinct from 'taslak' then
    raise exception 'Satır yalnız taslak reçete sürümüne eklenebilir' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create or replace trigger bom_assignment_guard
  before insert or update or delete on public.bom_assignments
  for each row execute function public.tg_bom_child_guard();
create or replace trigger bom_line_guard
  before insert or update or delete on public.bom_lines
  for each row execute function public.tg_bom_child_guard();

-- =====================================================================
-- D) SÜRÜM OLUŞTURMA (tek işlem) VE ONAY
--   p_payload = { notes, based_on, engine_version, error_count, warning_count, warnings[],
--                 assignments: [{ key, quantity_item_id, kanat, opening, system_id, sort_order }],
--                 lines: [{ assignment_key, component_id, rule_id, line_key, role, code, name, unit, cut_length_mm,
--                           angle, pieces, total_length_mm, net_quantity, waste_pct, waste_qty, quantity,
--                           standard_length_mm, weight_kg, cost_rate_id, unit_cost, currency, cost_unit, line_cost }] }
--   Poz ölçüleri ve onay durumu istemciden değil metraj tablosundan alınır.
-- =====================================================================
create or replace function public.create_bom_version(p_project uuid, p_takeoff uuid, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tk        public.quantity_takeoffs;
  v_rev       integer;
  v_id        uuid := gen_random_uuid();
  v_a         jsonb;
  v_l         jsonb;
  v_item      public.quantity_items;
  v_aid       uuid;
  v_keys      jsonb := '{}'::jsonb;
  v_sys       public.product_systems;
  v_approved  boolean;
  v_n         integer := 0;
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz' using errcode = '42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or jsonb_typeof(p_payload -> 'assignments') is distinct from 'array' or jsonb_typeof(p_payload -> 'lines') is distinct from 'array' then
    raise exception 'Geçersiz reçete verisi' using errcode = '22023';
  end if;
  if jsonb_array_length(p_payload -> 'assignments') = 0 then
    raise exception 'Reçetede poz yok' using errcode = '22023';
  end if;
  if jsonb_array_length(p_payload -> 'assignments') > 5000 or jsonb_array_length(p_payload -> 'lines') > 20000 then
    raise exception 'Reçete çok büyük' using errcode = '22023';
  end if;
  select * into v_tk from public.quantity_takeoffs where id = p_takeoff;
  if v_tk.id is null or v_tk.project_id <> p_project then
    raise exception 'Metraj sürümü bu projeye ait değil' using errcode = 'check_violation';
  end if;

  -- Pozlar metraj tablosundan doğrulanır; onaylı kaynak = metraj onaylı VE tüm pozlar onaylı (belirsiz değil)
  v_approved := v_tk.status = 'onaylandi';
  for v_a in select * from jsonb_array_elements(p_payload -> 'assignments') loop
    select * into v_item from public.quantity_items where id = nullif(v_a ->> 'quantity_item_id', '')::uuid;
    if v_item.id is null or v_item.takeoff_id <> v_tk.id then
      raise exception 'Poz bu metraj sürümüne ait değil' using errcode = 'check_violation';
    end if;
    if v_item.verification = 'reddedildi' then
      raise exception 'Reddedilmiş poz reçeteye alınamaz: %', v_item.poz_code using errcode = 'check_violation';
    end if;
    if v_item.verification <> 'onaylandi' or v_item.uncertain then
      v_approved := false;
    end if;
  end loop;
  if (select count(distinct a ->> 'quantity_item_id') from jsonb_array_elements(p_payload -> 'assignments') a)
     <> jsonb_array_length(p_payload -> 'assignments') then
    raise exception 'Aynı poz reçetede iki kez yer alamaz' using errcode = 'check_violation';
  end if;

  -- Revizyon numarası: proje başına kilit (eşzamanlı iki hesaplama aynı numarayı alamaz)
  perform pg_advisory_xact_lock(hashtextextended('leonx_bom:' || p_project::text, 0));
  select coalesce(max(revision), 0) + 1 into v_rev from public.bom_versions where project_id = p_project;

  perform set_config('leonx.bom_internal', 'on', true);
  insert into public.bom_versions (id, project_id, takeoff_id, takeoff_revision, takeoff_name, takeoff_status, revision, status,
    source_approved, error_count, warning_count, warnings, engine_version, based_on, notes)
  values (v_id, p_project, v_tk.id, v_tk.revision, v_tk.name, v_tk.status, v_rev, 'taslak', v_approved,
    greatest(coalesce((p_payload ->> 'error_count')::integer, 0), 0),
    greatest(coalesce((p_payload ->> 'warning_count')::integer, 0), 0),
    case when jsonb_typeof(p_payload -> 'warnings') = 'array' then p_payload -> 'warnings' else '[]'::jsonb end,
    left(coalesce(nullif(p_payload ->> 'engine_version', ''), 'bom-1'), 40),
    (select b.id from public.bom_versions b where b.id = nullif(p_payload ->> 'based_on', '')::uuid and b.project_id = p_project),
    nullif(left(p_payload ->> 'notes', 2000), ''));
  perform set_config('leonx.bom_internal', 'off', true);

  for v_a in select * from jsonb_array_elements(p_payload -> 'assignments') loop
    select * into v_item from public.quantity_items where id = (v_a ->> 'quantity_item_id')::uuid;
    v_sys := null;
    if nullif(v_a ->> 'system_id', '') is not null then
      select * into v_sys from public.product_systems where id = (v_a ->> 'system_id')::uuid;
      if v_sys.id is null then
        raise exception 'Ürün sistemi bulunamadı' using errcode = 'foreign_key_violation';
      end if;
    end if;
    insert into public.bom_assignments (bom_version_id, quantity_item_id, poz_code, category, width_mm, height_mm, quantity,
      verification, kanat, opening, system_id, system_name, sort_order)
    values (v_id, v_item.id, v_item.poz_code, v_item.category, v_item.width_mm, v_item.height_mm, v_item.quantity,
      case when v_item.verification = 'onaylandi' and v_item.uncertain then 'bekliyor' else v_item.verification end,
      nullif(v_a ->> 'kanat', '')::integer, nullif(left(v_a ->> 'opening', 200), ''), v_sys.id, v_sys.name,
      coalesce((v_a ->> 'sort_order')::integer, v_n))
    returning id into v_aid;
    v_n := v_n + 1;
    if coalesce(v_a ->> 'key', '') <> '' then
      v_keys := v_keys || jsonb_build_object(v_a ->> 'key', v_aid);
    end if;
  end loop;

  v_n := 0;
  for v_l in select * from jsonb_array_elements(p_payload -> 'lines') loop
    v_aid := null;
    if nullif(v_l ->> 'assignment_key', '') is not null then
      if not (v_keys ? (v_l ->> 'assignment_key')) then
        raise exception 'Satırın poz ataması bulunamadı' using errcode = '22023';
      end if;
      v_aid := (v_keys ->> (v_l ->> 'assignment_key'))::uuid;
    end if;
    insert into public.bom_lines (bom_version_id, assignment_id, component_id, rule_id, line_key, poz_code, role, code, name, unit,
      cut_length_mm, angle, pieces, total_length_mm, net_quantity, waste_pct, waste_qty, quantity, standard_length_mm, weight_kg,
      cost_rate_id, unit_cost, currency, cost_unit, line_cost, sort_order)
    values (v_id, v_aid,
      (select c.id from public.system_components c where c.id = nullif(v_l ->> 'component_id', '')::uuid),
      (select r.id from public.system_rules r where r.id = nullif(v_l ->> 'rule_id', '')::uuid),
      v_l ->> 'line_key', (select a.poz_code from public.bom_assignments a where a.id = v_aid),
      v_l ->> 'role', nullif(v_l ->> 'code', ''), v_l ->> 'name', v_l ->> 'unit',
      (v_l ->> 'cut_length_mm')::numeric, nullif(v_l ->> 'angle', ''), (v_l ->> 'pieces')::numeric, (v_l ->> 'total_length_mm')::numeric,
      (v_l ->> 'net_quantity')::numeric, coalesce((v_l ->> 'waste_pct')::numeric, 0), coalesce((v_l ->> 'waste_qty')::numeric, 0),
      (v_l ->> 'quantity')::numeric, (v_l ->> 'standard_length_mm')::integer, (v_l ->> 'weight_kg')::numeric,
      (select cr.id from public.cost_rates cr where cr.id = nullif(v_l ->> 'cost_rate_id', '')::uuid),
      (v_l ->> 'unit_cost')::numeric, nullif(v_l ->> 'currency', ''), nullif(v_l ->> 'cost_unit', ''), (v_l ->> 'line_cost')::numeric,
      coalesce((v_l ->> 'sort_order')::integer, v_n));
    v_n := v_n + 1;
  end loop;
  return v_id;
end;
$$;

-- Onay: yalnız onaylı kaynaktan ve hatasız taslak (kural tetikleyicide; istemci doğrudan güncellese de aynı kural)
create or replace function public.approve_bom_version(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_n integer;
begin
  update public.bom_versions set status = 'onayli' where id = p_id and status = 'taslak';
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Taslak reçete sürümü bulunamadı' using errcode = 'no_data_found';
  end if;
end;
$$;

-- =====================================================================
-- E) GÖRÜNÜMLER (security_invoker: RLS geçerli)
-- =====================================================================
create or replace view public.bom_material_totals with (security_invoker = true) as
select l.bom_version_id,
       l.role,
       l.code,
       l.name,
       l.unit,
       count(*)::integer                          as line_count,
       sum(l.pieces)                              as pieces,
       sum(l.total_length_mm)                     as total_length_mm,
       sum(l.net_quantity)                        as net_quantity,
       sum(l.waste_qty)                           as waste_qty,
       sum(l.quantity)                            as quantity,
       max(l.standard_length_mm)                  as standard_length_mm,
       -- Tahmini boy adedi = yukarı yuvarla(fire dahil toplam boy / standart boy); kesim optimizasyonu değildir
       case when l.unit = 'mm_profil' and max(l.standard_length_mm) is not null
            then ceil(sum(l.quantity) * 1000 / max(l.standard_length_mm))::integer end as bar_estimate,
       sum(l.weight_kg)                           as weight_kg
  from public.bom_lines l
 group by l.bom_version_id, l.role, l.code, l.name, l.unit;

create or replace view public.bom_cut_list with (security_invoker = true) as
select l.bom_version_id,
       l.code,
       l.name,
       l.role,
       l.cut_length_mm,
       coalesce(l.angle, '')                      as angle,
       sum(l.pieces)                              as pieces,
       max(l.standard_length_mm)                  as standard_length_mm,
       string_agg(distinct l.poz_code, ', ')      as poz_codes
  from public.bom_lines l
 where l.unit = 'mm_profil'
 group by l.bom_version_id, l.code, l.name, l.role, l.cut_length_mm, coalesce(l.angle, '');

-- =====================================================================
-- F) FONKSİYON YETKİLERİ (tetikleyici fonksiyonları istemciden çağrılamaz)
-- =====================================================================
revoke all on function public.tg_bom_version_guard() from public, anon, authenticated;
revoke all on function public.tg_bom_child_guard() from public, anon, authenticated;
revoke all on function public.create_bom_version(uuid, uuid, jsonb) from public, anon;
revoke all on function public.approve_bom_version(uuid) from public, anon;
grant execute on function public.create_bom_version(uuid, uuid, jsonb) to authenticated;
grant execute on function public.approve_bom_version(uuid) to authenticated;

-- =====================================================================
-- G) YETKİLER VE RLS
--   Sürüm, atama ve satır yalnız create_bom_version() ile eklenir (doğrudan INSERT yetkisi yok);
--   atama ve satırlar doğrudan değiştirilemez/silinemez (taslak sürüm silinince zincirleme silinir).
-- =====================================================================
revoke all on table public.product_systems, public.system_components, public.system_rules, public.bom_versions,
  public.bom_assignments, public.bom_lines, public.bom_material_totals, public.bom_cut_list from anon;
revoke all on table public.product_systems, public.system_components, public.system_rules, public.bom_versions,
  public.bom_assignments, public.bom_lines, public.bom_material_totals, public.bom_cut_list from authenticated;
grant select, insert, update, delete on table public.product_systems, public.system_components, public.system_rules to authenticated;
grant select, update, delete on table public.bom_versions to authenticated;
grant select on table public.bom_assignments, public.bom_lines, public.bom_material_totals, public.bom_cut_list to authenticated;

alter table public.product_systems   enable row level security;
alter table public.system_components enable row level security;
alter table public.system_rules      enable row level security;
alter table public.bom_versions      enable row level security;
alter table public.bom_assignments   enable row level security;
alter table public.bom_lines         enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['product_systems', 'system_components', 'system_rules'] loop
    perform pg_temp.leonx_policy('public', t, 'owner_select', 'select', '(select public.is_owner())', null);
    perform pg_temp.leonx_policy('public', t, 'owner_insert', 'insert', null, '(select public.is_owner())');
    perform pg_temp.leonx_policy('public', t, 'owner_update', 'update', '(select public.is_owner())', '(select public.is_owner())');
    perform pg_temp.leonx_policy('public', t, 'owner_delete', 'delete', '(select public.is_owner())', null);
  end loop;
  perform pg_temp.leonx_policy('public', 'bom_versions', 'owner_select', 'select', '(select public.is_owner())', null);
  perform pg_temp.leonx_policy('public', 'bom_versions', 'owner_update', 'update', '(select public.is_owner())', '(select public.is_owner())');
  perform pg_temp.leonx_policy('public', 'bom_versions', 'owner_delete', 'delete', '(select public.is_owner())', null);
  perform pg_temp.leonx_policy('public', 'bom_assignments', 'owner_select', 'select', '(select public.is_owner())', null);
  perform pg_temp.leonx_policy('public', 'bom_lines', 'owner_select', 'select', '(select public.is_owner())', null);
end;
$$;

-- =====================================================================
-- H) REALTIME
-- =====================================================================
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['product_systems', 'system_components', 'system_rules', 'bom_versions', 'bom_assignments', 'bom_lines'] loop
      if not exists (
        select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;
