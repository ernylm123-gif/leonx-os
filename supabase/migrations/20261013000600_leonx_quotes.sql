-- =====================================================================
-- LEONX OS — 006: Teklif, maliyet ve poz yönetimi
--
-- Tablolar
--   quotes          Teklifler. Her revizyon ayrı satırdır; aynı teklif numarasını ve root_id'yi paylaşır.
--   quote_items     Teklif kalemleri (poz, ölçü, adet, birim, maliyet, satış fiyatı, metraj kaynağı)
--   quote_history   Oluşturma, durum değişikliği ve revizyon kaydı (yalnız okunur; tetikleyici yazar)
--   quote_settings  Teklif çıktısındaki firma bilgileri ve varsayılanlar (tek satır)
--   quote_counters  Yıllık teklif numarası sayacı (istemciye kapalı; yalnız tetikleyici kullanır)
--
-- Kurallar (veritabanında uygulanır, istemciye güvenilmez)
--   • Teklif numarası (ör. TKL-2026-0001) sunucuda atomik sayaçla atanır; çakışma olmaz.
--   • Yalnızca "taslak" teklifin içeriği ve kalemleri değiştirilebilir. Gönderilen teklif için
--     revizyon oluşturulur; eski revizyon kilitlenir (superseded) ve geçmiş olarak saklanır.
--   • Gönderilmiş teklif taslağa döndürülemez ve silinemez (reddedildi olarak işaretlenebilir).
--   • Proje silinirse teklif korunur (project_id boşalır). Teklifi olan firma silinemez.
--   • Metraj pozu silinirse teklif kalemi korunur (kaynak bağlantısı boşalır).
--
-- Güvenlik: tüm tablolarda RLS açık, erişim yalnızca public.is_owner(). anon hiçbir yetkiye sahip değil.
-- Tekrar çalıştırılabilir; DROP veya veri silme içermez.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Teklif ayarları (tek satır)
-- ---------------------------------------------------------------------
create table if not exists public.quote_settings (
  id                     smallint primary key default 1 check (id = 1),
  legal_name             text check (legal_name is null or char_length(legal_name) <= 200),
  address                text check (address is null or char_length(address) <= 500),
  phone                  text check (phone is null or char_length(phone) <= 60),
  email                  text check (email is null or char_length(email) <= 254),
  website                text check (website is null or char_length(website) <= 200),
  tax_office             text check (tax_office is null or char_length(tax_office) <= 120),
  tax_number             text check (tax_number is null or tax_number ~ '^[0-9]{10,11}$'),
  bank_name              text check (bank_name is null or char_length(bank_name) <= 120),
  iban                   text check (iban is null or iban ~ '^[A-Z]{2}[0-9A-Z]{13,32}$'),
  quote_prefix           text not null default 'TKL' check (quote_prefix ~ '^[A-Z0-9]{1,8}$'),
  default_validity_days  integer not null default 15 check (default_validity_days between 1 and 365),
  default_vat_pct        numeric(5, 2) not null default 20 check (default_vat_pct between 0 and 100),
  default_currency       text not null default 'TRY' check (default_currency in ('TRY', 'EUR', 'USD')),
  default_payment_terms  text check (default_payment_terms is null or char_length(default_payment_terms) <= 2000),
  default_delivery_terms text check (default_delivery_terms is null or char_length(default_delivery_terms) <= 2000),
  closing_text           text check (closing_text is null or char_length(closing_text) <= 2000),
  created_by             uuid,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  version                integer not null default 1 check (version >= 1)
);

create table if not exists public.quote_counters (
  year    integer primary key check (year between 2000 and 2999),
  last_no integer not null check (last_no >= 0)
);

-- ---------------------------------------------------------------------
-- Teklifler
-- ---------------------------------------------------------------------
create table if not exists public.quotes (
  id               uuid primary key default gen_random_uuid(),
  root_id          uuid not null,
  quote_no         text not null check (char_length(quote_no) between 3 and 40),
  revision         integer not null default 1 check (revision between 1 and 999),
  superseded       boolean not null default false,
  company_id       uuid not null references public.companies (id) on delete restrict,
  contact_id       uuid references public.contacts (id) on delete set null,
  project_id       uuid references public.projects (id) on delete set null,
  title            text not null check (char_length(btrim(title)) between 1 and 200),
  scope            text check (scope is null or char_length(scope) <= 5000),
  status           text not null default 'taslak' check (status in ('taslak', 'gonderildi', 'gorusmede', 'kabul', 'red')),
  quote_date       date not null default current_date,
  valid_until      date,
  currency         text not null default 'TRY' check (currency in ('TRY', 'EUR', 'USD')),
  pricing_mode     text not null default 'detayli' check (pricing_mode in ('detayli', 'toplam')),
  lump_sum         numeric(14, 2) check (lump_sum is null or (lump_sum >= 0 and lump_sum <= 999999999999)),
  lump_cost        numeric(14, 2) check (lump_cost is null or (lump_cost >= 0 and lump_cost <= 999999999999)),
  waste_pct        numeric(6, 2) not null default 0 check (waste_pct between 0 and 100),
  overhead_pct     numeric(6, 2) not null default 0 check (overhead_pct between 0 and 500),
  profit_pct       numeric(7, 2) not null default 0 check (profit_pct between 0 and 1000),
  shipping_amount  numeric(14, 2) not null default 0 check (shipping_amount between 0 and 999999999999),
  other_amount     numeric(14, 2) not null default 0 check (other_amount between 0 and 999999999999),
  other_label      text check (other_label is null or char_length(other_label) <= 80),
  discount_kind    text not null default 'yok' check (discount_kind in ('yok', 'yuzde', 'tutar')),
  discount_value   numeric(14, 2) not null default 0 check (discount_value >= 0 and discount_value <= 999999999999),
  vat_pct          numeric(5, 2) not null default 20 check (vat_pct between 0 and 100),
  hide_unit_prices boolean not null default false,
  payment_terms    text check (payment_terms is null or char_length(payment_terms) <= 2000),
  delivery_terms   text check (delivery_terms is null or char_length(delivery_terms) <= 2000),
  notes            text check (notes is null or char_length(notes) <= 5000),
  internal_notes   text check (internal_notes is null or char_length(internal_notes) <= 5000),
  sent_at          timestamptz,
  decided_at       timestamptz,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  version          integer not null default 1 check (version >= 1),
  constraint quotes_no_revision_unique unique (quote_no, revision),
  constraint quotes_root_revision_unique unique (root_id, revision),
  constraint quotes_validity_check check (valid_until is null or valid_until >= quote_date),
  constraint quotes_discount_pct_check check (discount_kind <> 'yuzde' or discount_value <= 100)
);
create index if not exists quotes_company_idx on public.quotes (company_id);
create index if not exists quotes_project_idx on public.quotes (project_id);
create index if not exists quotes_root_idx on public.quotes (root_id, revision desc);
create index if not exists quotes_date_idx on public.quotes (quote_date desc, quote_no desc);

-- ---------------------------------------------------------------------
-- Teklif kalemleri
-- ---------------------------------------------------------------------
create table if not exists public.quote_items (
  id                uuid primary key default gen_random_uuid(),
  quote_id          uuid not null references public.quotes (id) on delete cascade,
  sort_order        integer not null default 0,
  poz_code          text check (poz_code is null or char_length(poz_code) <= 40),
  description       text not null check (char_length(btrim(description)) between 1 and 2000),
  system_type       text check (system_type is null or char_length(system_type) <= 120),
  width_mm          numeric(9, 1) check (width_mm is null or (width_mm > 0 and width_mm <= 100000)),
  height_mm         numeric(9, 1) check (height_mm is null or (height_mm > 0 and height_mm <= 100000)),
  dim_unit          text not null default 'mm' check (dim_unit in ('mm', 'cm', 'm')),
  quantity          numeric(12, 3) not null default 1 check (quantity > 0 and quantity <= 1000000),
  unit              text not null default 'adet' check (unit in ('adet', 'm2', 'mtul', 'm', 'kg', 'takim', 'goturu')),
  manual_measure    numeric(14, 3) check (manual_measure is null or (manual_measure > 0 and manual_measure <= 100000000)),
  material_cost     numeric(14, 2) not null default 0 check (material_cost between 0 and 999999999999),
  labor_cost        numeric(14, 2) not null default 0 check (labor_cost between 0 and 999999999999),
  install_cost      numeric(14, 2) not null default 0 check (install_cost between 0 and 999999999999),
  other_cost        numeric(14, 2) not null default 0 check (other_cost between 0 and 999999999999),
  unit_price        numeric(14, 2) check (unit_price is null or unit_price between 0 and 999999999999),
  notes             text check (notes is null or char_length(notes) <= 2000),
  source            text not null default 'elle' check (source in ('elle', 'metraj')),
  source_item_id    uuid references public.quantity_items (id) on delete set null,
  source_takeoff_id uuid references public.quantity_takeoffs (id) on delete set null,
  source_label      text check (source_label is null or char_length(source_label) <= 200),
  measure_verified  boolean not null default true,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  version           integer not null default 1 check (version >= 1)
);
create index if not exists quote_items_quote_idx on public.quote_items (quote_id, sort_order);
create index if not exists quote_items_source_idx on public.quote_items (source_item_id);

-- ---------------------------------------------------------------------
-- Teklif geçmişi
-- ---------------------------------------------------------------------
create table if not exists public.quote_history (
  id          bigint generated always as identity primary key,
  quote_id    uuid not null references public.quotes (id) on delete cascade,
  root_id     uuid not null,
  action      text not null check (action in ('olustur', 'durum', 'revizyon', 'kopya')),
  from_status text,
  to_status   text,
  note        text,
  changed_by  uuid,
  changed_at  timestamptz not null default now()
);
create index if not exists quote_history_root_idx on public.quote_history (root_id, changed_at desc);

-- ---------------------------------------------------------------------
-- Ortak tetikleyiciler: created_by / updated_at / version
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['quotes', 'quote_items', 'quote_settings'] loop
    execute format('create or replace trigger set_created_by before insert on public.%I for each row execute function public.tg_set_created_by()', t);
    execute format('create or replace trigger touch_row before update on public.%I for each row execute function public.tg_touch_row()', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- Teklif numarası: yeni teklifte atomik yıllık sayaç; revizyonda kök teklifin numarası.
-- SECURITY DEFINER: sayaç tablosu istemciye kapalıdır. İstemcinin verdiği numara yok sayılır.
-- ---------------------------------------------------------------------
create or replace function public.tg_quote_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year   integer := extract(year from coalesce(new.quote_date, current_date))::integer;
  v_no     integer;
  v_prefix text;
begin
  if new.revision = 1 then
    select quote_prefix into v_prefix from public.quote_settings where id = 1;
    insert into public.quote_counters as c (year, last_no) values (v_year, 1)
    on conflict (year) do update set last_no = c.last_no + 1
    returning last_no into v_no;
    new.root_id := new.id;
    new.quote_no := coalesce(v_prefix, 'TKL') || '-' || v_year || '-' || lpad(v_no::text, 4, '0');
  else
    select quote_no into new.quote_no from public.quotes where id = new.root_id and revision = 1;
    if new.quote_no is null then
      raise exception 'Revizyonun bağlı olduğu teklif bulunamadı' using errcode = 'foreign_key_violation';
    end if;
  end if;
  new.superseded := false;
  if new.status <> 'taslak' then
    raise exception 'Yeni teklif veya revizyon taslak olarak oluşturulur' using errcode = 'check_violation';
  end if;
  new.sent_at := null;
  new.decided_at := null;
  return new;
end;
$$;

create or replace trigger quote_number
  before insert on public.quotes
  for each row execute function public.tg_quote_number();

-- ---------------------------------------------------------------------
-- Teklif kilidi ve durum kuralları. pg_trigger_depth() > 1: yabancı anahtar eylemi
-- (proje silinince project_id = null) veya sistem tetikleyicisi — izinli.
-- ---------------------------------------------------------------------
create or replace function public.tg_quote_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  -- İçerik sayılmayan alanlar: gönderilmiş teklifte de değişebilir
  v_free constant text[] := array['status', 'superseded', 'sent_at', 'decided_at', 'internal_notes', 'project_id', 'updated_at', 'version', 'created_at', 'created_by'];
begin
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if old.superseded then
      raise exception 'Eski teklif revizyonu silinemez; geçmiş olarak saklanır' using errcode = 'check_violation';
    end if;
    if old.status <> 'taslak' then
      raise exception 'Gönderilmiş teklif silinemez; durumunu "Reddedildi" yapabilirsiniz' using errcode = 'check_violation';
    end if;
    return old;
  end if;
  if new.root_id is distinct from old.root_id or new.quote_no is distinct from old.quote_no or new.revision is distinct from old.revision then
    raise exception 'Teklif numarası ve revizyonu değiştirilemez' using errcode = 'check_violation';
  end if;
  if old.superseded then
    if (to_jsonb(new) - array['project_id', 'internal_notes', 'updated_at', 'version', 'created_at', 'created_by']) is distinct from (to_jsonb(old) - array['project_id', 'internal_notes', 'updated_at', 'version', 'created_at', 'created_by']) then
      raise exception 'Eski teklif revizyonu değiştirilemez; güncel revizyonu kullanın' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if new.superseded is distinct from old.superseded and new.superseded = false then
    raise exception 'Teklif revizyon kilidi kaldırılamaz' using errcode = 'check_violation';
  end if;
  if old.status <> 'taslak' then
    if new.status = 'taslak' then
      raise exception 'Gönderilmiş teklif taslağa döndürülemez; değişiklik için revizyon oluşturun' using errcode = 'check_violation';
    end if;
    if (to_jsonb(new) - v_free) is distinct from (to_jsonb(old) - v_free) then
      raise exception 'Gönderilmiş teklifin içeriği değiştirilemez; revizyon oluşturun' using errcode = 'check_violation';
    end if;
  end if;
  if new.status is distinct from old.status then
    if new.status in ('gonderildi', 'gorusmede', 'kabul', 'red') and new.sent_at is null then
      new.sent_at := now();
    end if;
    if new.status in ('kabul', 'red') then
      new.decided_at := now();
    elsif old.status in ('kabul', 'red') then
      new.decided_at := null;
    end if;
  end if;
  return new;
end;
$$;

create or replace trigger quote_guard
  before update or delete on public.quotes
  for each row execute function public.tg_quote_guard();

-- Kalemler yalnızca güncel taslak teklifte eklenir / değiştirilir / silinir
create or replace function public.tg_quote_item_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status     text;
  v_superseded boolean;
begin
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;
  select status, superseded into v_status, v_superseded from public.quotes where id = coalesce(new.quote_id, old.quote_id);
  if v_status is null then
    raise exception 'Teklif bulunamadı' using errcode = 'foreign_key_violation';
  end if;
  if v_superseded or v_status <> 'taslak' then
    raise exception 'Gönderilmiş veya eski revizyon teklifin kalemleri değiştirilemez; revizyon oluşturun' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and new.quote_id is distinct from old.quote_id then
    raise exception 'Kalem başka bir teklife taşınamaz' using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

create or replace trigger quote_item_guard
  before insert or update or delete on public.quote_items
  for each row execute function public.tg_quote_item_guard();

-- ---------------------------------------------------------------------
-- Geçmiş ve revizyon zinciri. SECURITY DEFINER: istemci geçmişe yazamaz.
-- Son taslak revizyon silinirse önceki revizyon yeniden güncel olur.
-- ---------------------------------------------------------------------
create or replace function public.tg_quote_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev uuid;
  v_copy text;
begin
  if tg_op = 'INSERT' then
    v_copy := nullif(current_setting('leonx.quote_copy_of', true), '');
    insert into public.quote_history (quote_id, root_id, action, to_status, note, changed_by)
    values (new.id, new.root_id,
            case when new.revision > 1 then 'revizyon' when v_copy is not null then 'kopya' else 'olustur' end, new.status,
            case when new.revision > 1 then 'Rev ' || new.revision when v_copy is not null then v_copy || ' kopyası' else null end,
            auth.uid());
  elsif tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      insert into public.quote_history (quote_id, root_id, action, from_status, to_status, changed_by)
      values (new.id, new.root_id, 'durum', old.status, new.status, auth.uid());
    end if;
  elsif tg_op = 'DELETE' then
    if old.revision > 1 then
      select id into v_prev from public.quotes where root_id = old.root_id order by revision desc limit 1;
      if v_prev is not null then
        update public.quotes set superseded = false where id = v_prev and superseded;
      end if;
    end if;
  end if;
  return null;
end;
$$;

create or replace trigger quote_history
  after insert or update or delete on public.quotes
  for each row execute function public.tg_quote_history();

-- ---------------------------------------------------------------------
-- Revizyon ve kopya. SECURITY INVOKER: RLS ve kilit kuralları geçerlidir.
--   p_mode = 'revizyon' → aynı numara, revizyon + 1; kaynak kilitlenir
--   p_mode = 'kopya'    → yeni numaralı bağımsız taslak teklif
-- ---------------------------------------------------------------------
create or replace function public.copy_quote(p_source uuid, p_mode text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  s     public.quotes;
  v_new uuid := gen_random_uuid();
  v_rev integer;
begin
  if p_mode not in ('revizyon', 'kopya') then
    raise exception 'Geçersiz işlem' using errcode = 'invalid_parameter_value';
  end if;
  select * into s from public.quotes where id = p_source;
  if s.id is null then
    raise exception 'Kaynak teklif bulunamadı' using errcode = 'no_data_found';
  end if;
  -- Geçmiş tetikleyicisi kopyanın kaynağını bu işlem içi ayardan okur (istemci geçmişe yazamaz)
  perform set_config('leonx.quote_copy_of', case when p_mode = 'kopya' then s.quote_no || ' Rev ' || s.revision else '' end, true);
  if p_mode = 'revizyon' then
    if s.superseded then
      raise exception 'Eski revizyondan yeni revizyon oluşturulamaz; güncel revizyonu kullanın' using errcode = 'check_violation';
    end if;
    select max(revision) + 1 into v_rev from public.quotes where root_id = s.root_id;
  else
    v_rev := 1;
  end if;
  insert into public.quotes (
    id, root_id, quote_no, revision, company_id, contact_id, project_id, title, scope, status, quote_date, valid_until,
    currency, pricing_mode, lump_sum, lump_cost, waste_pct, overhead_pct, profit_pct, shipping_amount, other_amount, other_label,
    discount_kind, discount_value, vat_pct, hide_unit_prices, payment_terms, delivery_terms, notes, internal_notes)
  values (
    v_new, case when p_mode = 'revizyon' then s.root_id else v_new end, s.quote_no, v_rev, s.company_id, s.contact_id, s.project_id,
    case when p_mode = 'kopya' then left(s.title || ' (kopya)', 200) else s.title end, s.scope, 'taslak', current_date,
    case when s.valid_until is null then null else current_date + (s.valid_until - s.quote_date) end,
    s.currency, s.pricing_mode, s.lump_sum, s.lump_cost, s.waste_pct, s.overhead_pct, s.profit_pct, s.shipping_amount, s.other_amount,
    s.other_label, s.discount_kind, s.discount_value, s.vat_pct, s.hide_unit_prices, s.payment_terms, s.delivery_terms, s.notes,
    s.internal_notes);
  insert into public.quote_items (
    quote_id, sort_order, poz_code, description, system_type, width_mm, height_mm, dim_unit, quantity, unit, manual_measure,
    material_cost, labor_cost, install_cost, other_cost, unit_price, notes, source, source_item_id, source_takeoff_id,
    source_label, measure_verified)
  select v_new, sort_order, poz_code, description, system_type, width_mm, height_mm, dim_unit, quantity, unit, manual_measure,
         material_cost, labor_cost, install_cost, other_cost, unit_price, notes, source, source_item_id, source_takeoff_id,
         source_label, measure_verified
    from public.quote_items
   where quote_id = p_source;
  if p_mode = 'revizyon' then
    update public.quotes set superseded = true where id = p_source;
  end if;
  perform set_config('leonx.quote_copy_of', '', true);
  return v_new;
end;
$$;

revoke all on function public.tg_quote_number() from public, anon;
revoke all on function public.tg_quote_guard() from public, anon;
revoke all on function public.tg_quote_item_guard() from public, anon;
revoke all on function public.tg_quote_history() from public, anon;
revoke all on function public.copy_quote(uuid, text) from public, anon;
grant execute on function public.copy_quote(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Yetkiler ve RLS
-- ---------------------------------------------------------------------
revoke all on table public.quotes, public.quote_items, public.quote_history, public.quote_settings, public.quote_counters from anon;
revoke all on table public.quotes, public.quote_items, public.quote_history, public.quote_settings, public.quote_counters from authenticated;
grant select, insert, update, delete on table public.quotes, public.quote_items to authenticated;
grant select on table public.quote_history to authenticated;
grant select, insert, update on table public.quote_settings to authenticated;

alter table public.quotes         enable row level security;
alter table public.quote_items    enable row level security;
alter table public.quote_history  enable row level security;
alter table public.quote_settings enable row level security;
alter table public.quote_counters enable row level security;

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
  foreach t in array array['quotes', 'quote_items'] loop
    perform pg_temp.leonx_policy('public', t, 'owner_select', 'select', '(select public.is_owner())', null);
    perform pg_temp.leonx_policy('public', t, 'owner_insert', 'insert', null, '(select public.is_owner())');
    perform pg_temp.leonx_policy('public', t, 'owner_update', 'update', '(select public.is_owner())', '(select public.is_owner())');
    perform pg_temp.leonx_policy('public', t, 'owner_delete', 'delete', '(select public.is_owner())', null);
  end loop;
end;
$$;
select pg_temp.leonx_policy('public', 'quote_history', 'owner_select', 'select', '(select public.is_owner())', null);
select pg_temp.leonx_policy('public', 'quote_settings', 'owner_select', 'select', '(select public.is_owner())', null);
select pg_temp.leonx_policy('public', 'quote_settings', 'owner_insert', 'insert', null, '(select public.is_owner())');
select pg_temp.leonx_policy('public', 'quote_settings', 'owner_update', 'update', '(select public.is_owner())', '(select public.is_owner())');
-- quote_counters: politika yok → istemci hiçbir satıra erişemez (yalnız SECURITY DEFINER tetikleyici)

-- ---------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['quotes', 'quote_items', 'quote_history', 'quote_settings'] loop
      if not exists (
        select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;
