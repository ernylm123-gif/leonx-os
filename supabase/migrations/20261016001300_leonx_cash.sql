-- =====================================================================
-- LEONX OS — 013: Manuel gelir-gider, kasa ve banka yönetimi (0.10.0)
--
-- Tablolar
--   finance_accounts     Kasa / banka / kredi kartı hesapları (açılış bakiyesi, para birimi)
--   finance_categories   Gelir ve gider kategorileri (sistem kategorileri + kullanıcı kategorileri)
--   finance_recurring    Düzenli gelir/gider şablonları (haftalık, aylık, üç aylık, yıllık)
--   finance_entries      Projeye BAĞLI OLMAYAN genel işletme gelir/giderleri
--   finance_transfers    Hesaplar arası virman (gelir veya gider DEĞİLDİR)
--   finance_documents    Fiş / fatura ekleri (özel "finance-documents" deposu)
--   finance_audit_log    Değişiklik geçmişi (yalnız sunucu yazar; sahip yalnız okur)
-- Mevcut tablolara eklenen boş bırakılabilir sütunlar (geriye uyumlu)
--   project_expenses.account_id / category_id / payment_method
--   project_collections.account_id / category_id
-- Görünümler (security_invoker: RLS geçerli)
--   finance_ledger            TEK nakit hareketi tanımı (istemci: src/finance/ledger.ts — aynı kurallar)
--   finance_account_balances  Hesap bakiyesi = açılış bakiyesi + Σ giriş − Σ çıkış (finance_ledger'dan)
--
-- Çift sayım engeli
--   • Projeye bağlı gelir = project_collections satırı; projeye bağlı gider = project_expenses satırı.
--     Genel (projesiz) gelir/gider = finance_entries satırı. Aynı hareket iki tabloda tutulmaz.
--   • Virman yalnız finance_transfers'tadır; gelir/gider raporlarına girmez.
--   • Bakiyeye yalnız GERÇEKLEŞEN hareketler girer: ödenmemiş gider, "bekliyor" kayıt ve alacaklar girmez.
--   • İptal edilen (voided) kayıt saklanır ama bakiye ve raporlara girmez. Genel kayıt ve virman silinemez.
--
-- Güvenlik: tüm yeni tablolarda RLS açık, erişim yalnızca public.is_owner(). anon hiçbir yetkiye sahip değil.
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

-- Kısıt yardımcısı: yoksa ekler (tekrar çalıştırmada aynı kısıt ikinci kez eklenmez)
create or replace function pg_temp.leonx_constraint(p_table text, p_name text, p_def text) returns void
language plpgsql
as $fn$
begin
  if not exists (select 1 from pg_constraint where conname = p_name and conrelid = ('public.' || p_table)::regclass) then
    execute format('alter table public.%I add constraint %I ', p_table, p_name) || p_def;
  end if;
end;
$fn$;

-- =====================================================================
-- A) HESAPLAR (kasa / banka / kredi kartı)
-- =====================================================================
create table if not exists public.finance_accounts (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (char_length(btrim(name)) between 1 and 120),
  kind            text not null default 'kasa' check (kind in ('kasa', 'banka', 'kredi_karti')),
  currency        text not null default 'TRY' check (currency in ('TRY', 'EUR', 'USD')),
  -- Açılış bakiyesi (kredi kartında borç için negatif olabilir); hareketler bunun üzerine eklenir
  opening_balance numeric(14, 2) not null default 0 check (opening_balance between -999999999999 and 999999999999),
  opening_date    date not null default current_date,
  bank_name       text check (bank_name is null or char_length(bank_name) <= 120),
  -- IBAN: boşluksuz büyük harf; ülke kodu + 2 kontrol hanesi + 10–30 harf/rakam (gevşek biçim denetimi)
  iban            text check (iban is null or iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$'),
  notes           text check (notes is null or char_length(notes) <= 2000),
  active          boolean not null default true,
  sort_order      integer not null default 0,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  version         integer not null default 1 check (version >= 1)
);
create unique index if not exists finance_accounts_name_unique on public.finance_accounts (lower(btrim(name)));

-- =====================================================================
-- B) KATEGORİLER
-- =====================================================================
create table if not exists public.finance_categories (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('gelir', 'gider')),
  -- Sistem kategorisinin sabit anahtarı (kullanıcı kategorilerinde boş)
  key         text check (key is null or key ~ '^[a-z_]{1,40}$'),
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  is_system   boolean not null default false,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  version     integer not null default 1 check (version >= 1),
  constraint finance_categories_kind_key_unique unique (kind, key),
  constraint finance_categories_system_key check (not is_system or key is not null)
);
create unique index if not exists finance_categories_name_unique on public.finance_categories (kind, lower(btrim(name)));

-- Sistem kategorileri (mevcut satırlar değiştirilmez)
insert into public.finance_categories (kind, key, name, is_system, sort_order) values
  ('gider', 'malzeme',  'Malzeme',            true, 10),
  ('gider', 'personel', 'Personel',           true, 20),
  ('gider', 'kira',     'Kira',               true, 30),
  ('gider', 'elektrik', 'Elektrik',           true, 40),
  ('gider', 'yakit',    'Yakıt',              true, 50),
  ('gider', 'nakliye',  'Nakliye',            true, 60),
  ('gider', 'yemek',    'Yemek',              true, 70),
  ('gider', 'bakim',    'Bakım',              true, 80),
  ('gider', 'vergi',    'Vergi',              true, 90),
  ('gider', 'diger',    'Diğer gider',        true, 100),
  ('gelir', 'satis',    'Satış',              true, 10),
  ('gelir', 'hizmet',   'Hizmet',             true, 20),
  ('gelir', 'faiz',     'Faiz',               true, 30),
  ('gelir', 'iade',     'İade',               true, 40),
  ('gelir', 'diger',    'Diğer gelir',        true, 50)
on conflict do nothing;

-- =====================================================================
-- C) DÜZENLİ GELİR / GİDER ŞABLONLARI
-- =====================================================================
create table if not exists public.finance_recurring (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('gelir', 'gider')),
  description    text not null check (char_length(btrim(description)) between 1 and 500),
  amount         numeric(14, 2) not null check (amount > 0 and amount <= 999999999999),
  vat_amount     numeric(14, 2) not null default 0 check (vat_amount >= 0 and vat_amount <= 999999999999),
  currency       text not null default 'TRY' check (currency in ('TRY', 'EUR', 'USD')),
  category_id    uuid not null references public.finance_categories (id) on delete restrict,
  account_id     uuid references public.finance_accounts (id) on delete restrict,
  payment_method text check (payment_method is null or payment_method in ('nakit', 'havale', 'cek', 'senet', 'kredi_karti', 'diger')),
  company_id     uuid references public.companies (id) on delete set null,
  frequency      text not null check (frequency in ('haftalik', 'aylik', 'uc_aylik', 'yillik')),
  start_date     date not null,
  end_date       date,
  -- Sıradaki üretilecek tarih (boşsa başlangıç tarihi)
  next_date      date not null,
  active         boolean not null default true,
  notes          text check (notes is null or char_length(notes) <= 2000),
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  version        integer not null default 1 check (version >= 1),
  constraint finance_recurring_dates check (end_date is null or end_date >= start_date)
);

-- =====================================================================
-- D) GENEL GELİR / GİDER (projeye bağlı olmayan)
-- =====================================================================
create table if not exists public.finance_entries (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('gelir', 'gider')),
  entry_date     date not null,
  -- KDV hariç tutar; KDV ayrı (nakit hareketi = tutar + KDV)
  amount         numeric(14, 2) not null check (amount > 0 and amount <= 999999999999),
  vat_amount     numeric(14, 2) not null default 0 check (vat_amount >= 0 and vat_amount <= 999999999999),
  currency       text not null default 'TRY' check (currency in ('TRY', 'EUR', 'USD')),
  category_id    uuid not null references public.finance_categories (id) on delete restrict,
  account_id     uuid references public.finance_accounts (id) on delete restrict,
  -- gerceklesti: kasadan/bankadan çıktı veya girdi; bekliyor: vadesi gelmemiş/ödenmemiş (bakiyeye girmez)
  status         text not null default 'gerceklesti' check (status in ('gerceklesti', 'bekliyor')),
  due_date       date,
  payment_method text check (payment_method is null or payment_method in ('nakit', 'havale', 'cek', 'senet', 'kredi_karti', 'diger')),
  company_id     uuid references public.companies (id) on delete set null,
  description    text not null check (char_length(btrim(description)) between 1 and 500),
  document_no    text check (document_no is null or char_length(document_no) <= 80),
  notes          text check (notes is null or char_length(notes) <= 2000),
  recurring_id   uuid references public.finance_recurring (id) on delete set null,
  occurrence_date date,
  voided_at      timestamptz,
  voided_reason  text check (voided_reason is null or char_length(btrim(voided_reason)) between 1 and 500),
  voided_by      uuid,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  version        integer not null default 1 check (version >= 1),
  -- Gerçekleşen hareket bir hesaba yazılır
  constraint finance_entries_account_required check (status <> 'gerceklesti' or account_id is not null),
  constraint finance_entries_void_reason check (voided_at is null or voided_reason is not null)
);
create index if not exists finance_entries_date_idx on public.finance_entries (entry_date desc);
create index if not exists finance_entries_account_idx on public.finance_entries (account_id);
create index if not exists finance_entries_category_idx on public.finance_entries (category_id);
-- Düzenli kayıt her tarih için bir kez üretilir (üretim fonksiyonu tekrar çağrılsa da çift kayıt olmaz)
create unique index if not exists finance_entries_recurring_unique
  on public.finance_entries (recurring_id, occurrence_date) where recurring_id is not null;

-- =====================================================================
-- E) HESAPLAR ARASI VİRMAN
-- =====================================================================
create table if not exists public.finance_transfers (
  id              uuid primary key default gen_random_uuid(),
  transfer_date   date not null,
  from_account_id uuid not null references public.finance_accounts (id) on delete restrict,
  to_account_id   uuid not null references public.finance_accounts (id) on delete restrict,
  -- Çıkan ve giren tutar; aynı para biriminde eşit olmalıdır, farklı birimde ikisi de elle girilir
  from_amount     numeric(14, 2) not null check (from_amount > 0 and from_amount <= 999999999999),
  to_amount       numeric(14, 2) not null check (to_amount > 0 and to_amount <= 999999999999),
  description     text check (description is null or char_length(description) <= 500),
  voided_at       timestamptz,
  voided_reason   text check (voided_reason is null or char_length(btrim(voided_reason)) between 1 and 500),
  voided_by       uuid,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  version         integer not null default 1 check (version >= 1),
  constraint finance_transfers_distinct check (from_account_id <> to_account_id),
  constraint finance_transfers_void_reason check (voided_at is null or voided_reason is not null)
);
create index if not exists finance_transfers_date_idx on public.finance_transfers (transfer_date desc);
create index if not exists finance_transfers_from_idx on public.finance_transfers (from_account_id);
create index if not exists finance_transfers_to_idx on public.finance_transfers (to_account_id);

-- =====================================================================
-- F) MEVCUT PROJE TABLOLARINA HESAP / KATEGORİ (boş bırakılabilir; eski kayıtlar "hesapsız")
-- =====================================================================
alter table public.project_expenses add column if not exists account_id uuid;
alter table public.project_expenses add column if not exists category_id uuid;
alter table public.project_expenses add column if not exists payment_method text;
alter table public.project_collections add column if not exists account_id uuid;
alter table public.project_collections add column if not exists category_id uuid;

select pg_temp.leonx_constraint('project_expenses', 'project_expenses_account_id_fkey',
  'foreign key (account_id) references public.finance_accounts (id) on delete restrict');
select pg_temp.leonx_constraint('project_expenses', 'project_expenses_category_id_fkey',
  'foreign key (category_id) references public.finance_categories (id) on delete restrict');
select pg_temp.leonx_constraint('project_expenses', 'project_expenses_payment_method_check',
  $$check (payment_method is null or payment_method in ('nakit', 'havale', 'cek', 'senet', 'kredi_karti', 'diger'))$$);
-- Hesaba yalnız ödenmiş gider yazılır (ödenmemiş gider hiçbir bakiyeyi etkilemez)
select pg_temp.leonx_constraint('project_expenses', 'project_expenses_account_paid_check',
  'check (account_id is null or paid)');
select pg_temp.leonx_constraint('project_collections', 'project_collections_account_id_fkey',
  'foreign key (account_id) references public.finance_accounts (id) on delete restrict');
select pg_temp.leonx_constraint('project_collections', 'project_collections_category_id_fkey',
  'foreign key (category_id) references public.finance_categories (id) on delete restrict');
create index if not exists project_expenses_account_idx on public.project_expenses (account_id) where account_id is not null;
create index if not exists project_collections_account_idx on public.project_collections (account_id) where account_id is not null;

-- =====================================================================
-- G) BELGE EKLERİ (fiş / fatura)
-- =====================================================================
create table if not exists public.finance_documents (
  id           uuid primary key default gen_random_uuid(),
  entry_table  text not null check (entry_table in ('finance_entries', 'project_expenses', 'project_collections')),
  entry_id     uuid not null,
  -- Yol: <entry_table>/<entry_id>/<benzersiz-ad>
  storage_path text not null unique check (char_length(storage_path) between 3 and 512),
  file_name    text not null check (char_length(btrim(file_name)) between 1 and 255),
  mime_type    text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')),
  size_bytes   bigint not null check (size_bytes > 0 and size_bytes <= 15728640),
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  constraint finance_documents_path_check check (storage_path like entry_table || '/' || entry_id::text || '/%')
);
create index if not exists finance_documents_entry_idx on public.finance_documents (entry_table, entry_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('finance-documents', 'finance-documents', false, 15728640,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- =====================================================================
-- H) DEĞİŞİKLİK GEÇMİŞİ (yalnız sunucu yazar)
-- =====================================================================
create table if not exists public.finance_audit_log (
  id          bigint generated always as identity primary key,
  table_name  text not null,
  row_id      uuid,
  action      text not null check (action in ('insert', 'update', 'void', 'delete')),
  changed_by  uuid default auth.uid(),
  changed_at  timestamptz not null default now(),
  old_row     jsonb,
  new_row     jsonb
);
create index if not exists finance_audit_log_row_idx on public.finance_audit_log (table_name, row_id, changed_at desc);

-- ---------------------------------------------------------------------
-- Ortak tetikleyiciler: created_by / updated_at / version
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['finance_accounts', 'finance_categories', 'finance_recurring', 'finance_entries', 'finance_transfers'] loop
    execute format('create or replace trigger set_created_by before insert on public.%I for each row execute function public.tg_set_created_by()', t);
    execute format('create or replace trigger touch_row before update on public.%I for each row execute function public.tg_touch_row()', t);
  end loop;
end;
$$;

-- =====================================================================
-- I) BÜTÜNLÜK KURALLARI
-- =====================================================================

-- Hesap kontrolü: hesap varsa para birimi aynı olmalı; gerçekleşen yeni harekete pasif hesap seçilemez
create or replace function public.leonx_fin_check_account(p_account uuid, p_currency text, p_realized boolean, p_changed boolean)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_currency text;
  v_active   boolean;
begin
  if p_account is null then
    return;
  end if;
  select currency, active into v_currency, v_active from public.finance_accounts where id = p_account;
  if v_currency is null then
    return; -- yabancı anahtar kısıtı bildirir
  end if;
  if v_currency <> p_currency then
    raise exception 'Hesabın para birimi (%) kayıtla aynı olmalıdır (%)', v_currency, p_currency using errcode = 'check_violation';
  end if;
  if p_realized and p_changed and not v_active then
    raise exception 'Pasif hesaba yeni hareket yazılamaz' using errcode = 'check_violation';
  end if;
end;
$$;

-- Kategori kontrolü: kategori türü kaydın türüyle aynı olmalı (gelir ↔ gelir, gider ↔ gider)
create or replace function public.leonx_fin_check_category(p_category uuid, p_kind text)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_kind text;
begin
  if p_category is null then
    return;
  end if;
  select kind into v_kind from public.finance_categories where id = p_category;
  if v_kind is not null and v_kind <> p_kind then
    raise exception 'Kategori türü kayıt türüyle uyuşmuyor (% kaydına % kategorisi seçilemez)', p_kind, v_kind using errcode = 'check_violation';
  end if;
end;
$$;

-- Genel gelir/gider
create or replace function public.tg_fin_entry_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.voided_at is not null then
    raise exception 'İptal edilmiş kayıt değiştirilemez' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and new.voided_at is not null then
    -- İptal: zaman ve kullanıcı sunucuda yazılır; iptal ile birlikte içerik değiştirilemez
    new.voided_at := now();
    new.voided_by := auth.uid();
    if (to_jsonb(new) - array['voided_at', 'voided_reason', 'voided_by', 'updated_at', 'version'])
       is distinct from (to_jsonb(old) - array['voided_at', 'voided_reason', 'voided_by', 'updated_at', 'version']) then
      raise exception 'Kayıt iptal edilirken içeriği değiştirilemez' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if tg_op = 'INSERT' and new.voided_at is not null then
    raise exception 'Kayıt iptal edilmiş olarak oluşturulamaz' using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' then
    new.voided_by := null;
  else
    new.voided_by := old.voided_by;
    new.recurring_id := old.recurring_id;
    new.occurrence_date := old.occurrence_date;
  end if;
  perform public.leonx_fin_check_category(new.category_id, new.kind);
  perform public.leonx_fin_check_account(new.account_id, new.currency, new.status = 'gerceklesti',
    tg_op = 'INSERT' or new.account_id is distinct from old.account_id or new.status is distinct from old.status);
  return new;
end;
$$;
create or replace trigger fin_entry_guard
  before insert or update on public.finance_entries
  for each row execute function public.tg_fin_entry_guard();

-- Virman: aynı para biriminde tutarlar eşit; iptal edilen virman değiştirilemez
create or replace function public.tg_fin_transfer_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_from_cur text;
  v_to_cur   text;
  v_from_act boolean;
  v_to_act   boolean;
begin
  if tg_op = 'UPDATE' and old.voided_at is not null then
    raise exception 'İptal edilmiş virman değiştirilemez' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and new.voided_at is not null then
    new.voided_at := now();
    new.voided_by := auth.uid();
    if (to_jsonb(new) - array['voided_at', 'voided_reason', 'voided_by', 'updated_at', 'version'])
       is distinct from (to_jsonb(old) - array['voided_at', 'voided_reason', 'voided_by', 'updated_at', 'version']) then
      raise exception 'Virman iptal edilirken içeriği değiştirilemez' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if tg_op = 'INSERT' and new.voided_at is not null then
    raise exception 'Virman iptal edilmiş olarak oluşturulamaz' using errcode = 'check_violation';
  end if;
  new.voided_by := case when tg_op = 'INSERT' then null else old.voided_by end;
  select currency, active into v_from_cur, v_from_act from public.finance_accounts where id = new.from_account_id;
  select currency, active into v_to_cur, v_to_act from public.finance_accounts where id = new.to_account_id;
  if v_from_cur is not null and v_to_cur is not null and v_from_cur = v_to_cur and new.from_amount <> new.to_amount then
    raise exception 'Aynı para birimindeki hesaplar arasında çıkan ve giren tutar eşit olmalıdır' using errcode = 'check_violation';
  end if;
  if (tg_op = 'INSERT' or new.from_account_id is distinct from old.from_account_id or new.to_account_id is distinct from old.to_account_id)
     and (v_from_act is false or v_to_act is false) then
    raise exception 'Pasif hesaba yeni hareket yazılamaz' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create or replace trigger fin_transfer_guard
  before insert or update on public.finance_transfers
  for each row execute function public.tg_fin_transfer_guard();

-- Genel kayıt ve virman SİLİNEMEZ: "silme" = iptal (sebep zorunlu); kayıt geçmiş olarak saklanır
create or replace function public.tg_fin_no_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Kayıt silinemez; iptal edin' using errcode = 'check_violation';
end;
$$;
create or replace trigger fin_no_delete before delete on public.finance_entries
  for each row execute function public.tg_fin_no_delete();
create or replace trigger fin_no_delete before delete on public.finance_transfers
  for each row execute function public.tg_fin_no_delete();

-- Proje gideri / tahsilatı: hesap para birimi ve kategori türü
create or replace function public.tg_fin_project_cash_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_new jsonb := to_jsonb(new);
  v_realized boolean;
begin
  -- Yabancı anahtar eylemi (ör. proje silinirken) denetlenmez
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if tg_table_name = 'project_expenses' then
    v_realized := (v_new ->> 'paid')::boolean;
    perform public.leonx_fin_check_category((v_new ->> 'category_id')::uuid, 'gider');
  else
    v_realized := true;
    perform public.leonx_fin_check_category((v_new ->> 'category_id')::uuid, 'gelir');
  end if;
  perform public.leonx_fin_check_account((v_new ->> 'account_id')::uuid, v_new ->> 'currency', v_realized,
    tg_op = 'INSERT' or (v_new ->> 'account_id') is distinct from (v_old ->> 'account_id'));
  return new;
end;
$$;
create or replace trigger fin_project_cash_guard
  before insert or update on public.project_expenses
  for each row execute function public.tg_fin_project_cash_guard();
create or replace trigger fin_project_cash_guard
  before insert or update on public.project_collections
  for each row execute function public.tg_fin_project_cash_guard();

-- Düzenli şablon: kategori/hesap kuralları; sıradaki tarih boşsa başlangıç
create or replace function public.tg_fin_recurring_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.next_date is null or (tg_op = 'UPDATE' and new.start_date is distinct from old.start_date and new.next_date is not distinct from old.next_date) then
    new.next_date := new.start_date;
  end if;
  perform public.leonx_fin_check_category(new.category_id, new.kind);
  perform public.leonx_fin_check_account(new.account_id, new.currency, false, false);
  return new;
end;
$$;
create or replace trigger fin_recurring_guard
  before insert or update on public.finance_recurring
  for each row execute function public.tg_fin_recurring_guard();

-- Kategoriler: sistem kategorisi silinemez, türü/anahtarı değişmez (yalnız ad, sıra ve pasifleştirme);
-- istemci sistem kategorisi oluşturamaz
create or replace function public.tg_fin_category_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_system then
      raise exception 'Sistem kategorisi silinemez; pasifleştirebilirsiniz' using errcode = 'check_violation';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.is_system := false;
      new.key := null;
    end if;
    return new;
  end if;
  if old.is_system and (new.kind is distinct from old.kind or new.key is distinct from old.key or not new.is_system) then
    raise exception 'Sistem kategorisinin türü ve anahtarı değiştirilemez' using errcode = 'check_violation';
  end if;
  if not old.is_system and (new.is_system or new.key is not null) then
    raise exception 'Kullanıcı kategorisi sistem kategorisine dönüştürülemez' using errcode = 'check_violation';
  end if;
  if new.kind is distinct from old.kind and (
       exists (select 1 from public.finance_entries where category_id = old.id)
       or exists (select 1 from public.finance_recurring where category_id = old.id)
       or exists (select 1 from public.project_expenses where category_id = old.id)
       or exists (select 1 from public.project_collections where category_id = old.id)) then
    raise exception 'Kullanılan kategorinin türü değiştirilemez' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create or replace trigger fin_category_guard
  before insert or update or delete on public.finance_categories
  for each row execute function public.tg_fin_category_guard();

-- Hesap: hareketi olan hesabın para birimi değiştirilemez
create or replace function public.tg_fin_account_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.iban is not null then
    new.iban := upper(replace(new.iban, ' ', ''));
  end if;
  if tg_op = 'UPDATE' and new.currency is distinct from old.currency and (
       exists (select 1 from public.finance_entries where account_id = old.id)
       or exists (select 1 from public.finance_transfers where from_account_id = old.id or to_account_id = old.id)
       or exists (select 1 from public.project_expenses where account_id = old.id)
       or exists (select 1 from public.project_collections where account_id = old.id)
       or exists (select 1 from public.finance_recurring where account_id = old.id)) then
    raise exception 'Hareketi olan hesabın para birimi değiştirilemez' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create or replace trigger fin_account_guard
  before insert or update on public.finance_accounts
  for each row execute function public.tg_fin_account_guard();

-- Belge eki: oluşturan sunucuda yazılır; bağlı kayıt mevcut olmalı
create or replace function public.tg_fin_document_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_by := auth.uid();
  new.created_at := now();
  if (new.entry_table = 'finance_entries' and not exists (select 1 from public.finance_entries where id = new.entry_id))
     or (new.entry_table = 'project_expenses' and not exists (select 1 from public.project_expenses where id = new.entry_id))
     or (new.entry_table = 'project_collections' and not exists (select 1 from public.project_collections where id = new.entry_id)) then
    raise exception 'Belgenin bağlanacağı kayıt bulunamadı' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create or replace trigger fin_document_guard
  before insert on public.finance_documents
  for each row execute function public.tg_fin_document_guard();

-- Değişiklik geçmişi: her ekleme / güncelleme / iptal / silme bir satır (yalnız kendi eklemesi hata verebilir)
create or replace function public.tg_fin_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_action text;
begin
  v_action := case tg_op
    when 'INSERT' then 'insert'
    when 'DELETE' then 'delete'
    else case when (v_new ->> 'voided_at') is not null and (v_old ->> 'voided_at') is null then 'void' else 'update' end
  end;
  insert into public.finance_audit_log (table_name, row_id, action, changed_by, old_row, new_row)
  values (tg_table_name, (coalesce(v_new, v_old) ->> 'id')::uuid, v_action, auth.uid(), v_old, v_new);
  return null;
end;
$$;
do $$
declare
  t text;
begin
  foreach t in array array['finance_accounts', 'finance_categories', 'finance_recurring', 'finance_entries', 'finance_transfers',
    'project_expenses', 'project_collections'] loop
    execute format('create or replace trigger fin_audit after insert or update or delete on public.%I for each row execute function public.tg_fin_audit()', t);
  end loop;
end;
$$;

-- =====================================================================
-- J) TEK NAKİT HAREKETİ TANIMI (görünüm)
--   Yalnız gerçekleşen hareketler: genel kayıt (gerceklesti, iptal değil), proje tahsilatı,
--   ödenmiş proje gideri, iptal edilmemiş virman (çıkış + giriş). Hesapsız satır bakiyeye girmez.
--   amount = nakit tutarı (gider/genel kayıtta KDV dahil), net_amount = KDV hariç.
--   (İstemci: src/finance/ledger.ts buildLedger — aynı kurallar)
-- =====================================================================
create or replace view public.finance_ledger
with (security_invoker = true)
as
select 'genel'::text as source, e.id as source_id, e.entry_date as movement_date, e.account_id, e.currency,
       case when e.kind = 'gelir' then 'giris' else 'cikis' end::text as direction,
       (e.amount + e.vat_amount)::numeric(14, 2) as amount, e.amount as net_amount, e.vat_amount,
       e.category_id, null::uuid as project_id, e.company_id, e.kind, e.status, e.description,
       e.payment_method, e.document_no, e.created_at
  from public.finance_entries e
 where e.status = 'gerceklesti' and e.voided_at is null
union all
select 'proje_tahsilat', c.id, c.received_date, c.account_id, c.currency, 'giris',
       c.amount, c.amount, 0::numeric(14, 2), c.category_id, c.project_id, p.company_id, 'gelir', 'gerceklesti',
       coalesce(nullif(btrim(c.note), ''), 'Tahsilat') , c.method, c.reference, c.created_at
  from public.project_collections c
  left join public.projects p on p.id = c.project_id
union all
select 'proje_gider', x.id, x.expense_date, x.account_id, x.currency, 'cikis',
       (x.amount + x.vat_amount)::numeric(14, 2), x.amount, x.vat_amount, x.category_id, x.project_id, p.company_id, 'gider', 'gerceklesti',
       x.description, x.payment_method, x.document_no, x.created_at
  from public.project_expenses x
  left join public.projects p on p.id = x.project_id
 where x.paid
union all
select 'transfer_cikis', t.id, t.transfer_date, t.from_account_id, a.currency, 'cikis',
       t.from_amount, t.from_amount, 0::numeric(14, 2), null::uuid, null::uuid, null::uuid, 'transfer', 'gerceklesti',
       coalesce(nullif(btrim(t.description), ''), 'Virman'), null::text, null::text, t.created_at
  from public.finance_transfers t
  join public.finance_accounts a on a.id = t.from_account_id
 where t.voided_at is null
union all
select 'transfer_giris', t.id, t.transfer_date, t.to_account_id, a.currency, 'giris',
       t.to_amount, t.to_amount, 0::numeric(14, 2), null::uuid, null::uuid, null::uuid, 'transfer', 'gerceklesti',
       coalesce(nullif(btrim(t.description), ''), 'Virman'), null::text, null::text, t.created_at
  from public.finance_transfers t
  join public.finance_accounts a on a.id = t.to_account_id
 where t.voided_at is null;

-- Bakiye = açılış bakiyesi + Σ giriş − Σ çıkış (yalnız finance_ledger'dan)
create or replace view public.finance_account_balances
with (security_invoker = true)
as
select a.id as account_id, a.name, a.kind, a.currency, a.active, a.opening_balance,
       coalesce(sum(l.amount) filter (where l.direction = 'giris'), 0)::numeric(14, 2) as total_in,
       coalesce(sum(l.amount) filter (where l.direction = 'cikis'), 0)::numeric(14, 2) as total_out,
       (a.opening_balance
         + coalesce(sum(l.amount) filter (where l.direction = 'giris'), 0)
         - coalesce(sum(l.amount) filter (where l.direction = 'cikis'), 0))::numeric(14, 2) as balance,
       count(l.source_id)::integer as movement_count,
       max(l.movement_date) as last_movement_date
  from public.finance_accounts a
  left join public.finance_ledger l on l.account_id = a.id
 group by a.id;

-- =====================================================================
-- K) DÜZENLİ KAYIT ÜRETİMİ
--   p_until (varsayılan: bugün, İstanbul) tarihine kadar her şablon için eksik tarihleri "bekliyor"
--   olarak üretir (vade = tarih). Tarihler başlangıçtan sayılır (ay sonu kaymaz: 31 Oca → 28/29 Şub → 31 Mar).
--   Benzersiz indeks sayesinde tekrar çağrı çift kayıt üretmez. Dönen değer: oluşturulan kayıt sayısı.
-- =====================================================================
create or replace function public.leonx_finance_generate_recurring(p_until date default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_until   date := coalesce(p_until, (now() at time zone 'Europe/Istanbul')::date);
  v_created integer := 0;
  v_n       integer;
  v_k       integer;
  v_occ     date;
  v_account uuid;
  r         record;
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz' using errcode = '42501';
  end if;
  if v_until > (now() at time zone 'Europe/Istanbul')::date + 400 then
    raise exception 'En fazla 400 gün ilerisi için düzenli kayıt üretilebilir' using errcode = '22023';
  end if;
  for r in select * from public.finance_recurring where active and next_date <= v_until and (end_date is null or next_date <= end_date) for update loop
    -- Pasif hesaba yazılmaz; kayıt hesapsız "bekliyor" olarak üretilir
    select id into v_account from public.finance_accounts where id = r.account_id and active;
    v_k := 0;
    loop
      v_occ := case r.frequency
        when 'haftalik' then r.start_date + v_k * 7
        when 'aylik' then (r.start_date + make_interval(months => v_k))::date
        when 'uc_aylik' then (r.start_date + make_interval(months => v_k * 3))::date
        else (r.start_date + make_interval(years => v_k))::date
      end;
      exit when v_occ > v_until or (r.end_date is not null and v_occ > r.end_date) or v_k > 10000;
      if v_occ >= r.next_date then
        insert into public.finance_entries (kind, entry_date, amount, vat_amount, currency, category_id, account_id, status, due_date,
          payment_method, company_id, description, recurring_id, occurrence_date)
        values (r.kind, v_occ, r.amount, r.vat_amount, r.currency, r.category_id, v_account, 'bekliyor', v_occ,
          r.payment_method, r.company_id, r.description, r.id, v_occ)
        on conflict (recurring_id, occurrence_date) where recurring_id is not null do nothing;
        get diagnostics v_n = row_count;
        v_created := v_created + v_n;
      end if;
      v_k := v_k + 1;
    end loop;
    -- Yalnız değiştiyse yazılır (gereksiz sürüm artışı, geçmiş satırı ve canlı olay üretilmez)
    if v_occ is distinct from r.next_date then
      update public.finance_recurring set next_date = v_occ where id = r.id;
    end if;
  end loop;
  return v_created;
end;
$$;
revoke all on function public.leonx_finance_generate_recurring(date) from public, anon;
grant execute on function public.leonx_finance_generate_recurring(date) to authenticated;

-- =====================================================================
-- L) FONKSİYON YETKİLERİ (tetikleyici ve iç fonksiyonlar istemciden çağrılamaz)
-- =====================================================================
do $$
declare
  f text;
begin
  foreach f in array array['tg_fin_entry_guard', 'tg_fin_transfer_guard', 'tg_fin_no_delete', 'tg_fin_project_cash_guard',
    'tg_fin_recurring_guard', 'tg_fin_category_guard', 'tg_fin_account_guard', 'tg_fin_document_guard', 'tg_fin_audit'] loop
    execute format('revoke all on function public.%I() from public, anon, authenticated', f);
  end loop;
end;
$$;
-- Yardımcılar tetikleyicilerden (çağıranın yetkisiyle) çağrılır; yalnız RLS altında okur, veri değiştirmez
revoke all on function public.leonx_fin_check_account(uuid, text, boolean, boolean) from public, anon;
revoke all on function public.leonx_fin_check_category(uuid, text) from public, anon;
grant execute on function public.leonx_fin_check_account(uuid, text, boolean, boolean) to authenticated;
grant execute on function public.leonx_fin_check_category(uuid, text) to authenticated;

-- =====================================================================
-- M) YETKİLER VE RLS
-- =====================================================================
revoke all on table public.finance_accounts, public.finance_categories, public.finance_recurring, public.finance_entries,
  public.finance_transfers, public.finance_documents, public.finance_audit_log, public.finance_ledger,
  public.finance_account_balances from anon;
revoke all on table public.finance_accounts, public.finance_categories, public.finance_recurring, public.finance_entries,
  public.finance_transfers, public.finance_documents, public.finance_audit_log, public.finance_ledger,
  public.finance_account_balances from authenticated;
grant select, insert, update, delete on table public.finance_accounts, public.finance_categories, public.finance_recurring,
  public.finance_entries, public.finance_transfers to authenticated;
grant select, insert, delete on table public.finance_documents to authenticated;
grant select on table public.finance_audit_log, public.finance_ledger, public.finance_account_balances to authenticated;

alter table public.finance_accounts   enable row level security;
alter table public.finance_categories enable row level security;
alter table public.finance_recurring  enable row level security;
alter table public.finance_entries    enable row level security;
alter table public.finance_transfers  enable row level security;
alter table public.finance_documents  enable row level security;
alter table public.finance_audit_log  enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['finance_accounts', 'finance_categories', 'finance_recurring', 'finance_entries', 'finance_transfers'] loop
    perform pg_temp.leonx_policy('public', t, 'owner_select', 'select', '(select public.is_owner())', null);
    perform pg_temp.leonx_policy('public', t, 'owner_insert', 'insert', null, '(select public.is_owner())');
    perform pg_temp.leonx_policy('public', t, 'owner_update', 'update', '(select public.is_owner())', '(select public.is_owner())');
    -- Silme politikası var; genel kayıt ve virmanda tetikleyici engeller (iptal kullanılır)
    perform pg_temp.leonx_policy('public', t, 'owner_delete', 'delete', '(select public.is_owner())', null);
  end loop;
  perform pg_temp.leonx_policy('public', 'finance_documents', 'owner_select', 'select', '(select public.is_owner())', null);
  perform pg_temp.leonx_policy('public', 'finance_documents', 'owner_insert', 'insert', null, '(select public.is_owner())');
  perform pg_temp.leonx_policy('public', 'finance_documents', 'owner_delete', 'delete', '(select public.is_owner())', null);
  perform pg_temp.leonx_policy('public', 'finance_audit_log', 'owner_select', 'select', '(select public.is_owner())', null);
end;
$$;

-- Depo: yalnız sahip; yol ilk klasörü izinli tablo adı olmalı
select pg_temp.leonx_policy('storage', 'objects', 'leonx_finance_documents_select', 'select',
  $$bucket_id = 'finance-documents' and (select public.is_owner())$$, null);
select pg_temp.leonx_policy('storage', 'objects', 'leonx_finance_documents_insert', 'insert', null,
  $$bucket_id = 'finance-documents' and (select public.is_owner()) and split_part(name, '/', 1) in ('finance_entries', 'project_expenses', 'project_collections')$$);
select pg_temp.leonx_policy('storage', 'objects', 'leonx_finance_documents_update', 'update',
  $$bucket_id = 'finance-documents' and (select public.is_owner())$$,
  $$bucket_id = 'finance-documents' and (select public.is_owner())$$);
select pg_temp.leonx_policy('storage', 'objects', 'leonx_finance_documents_delete', 'delete',
  $$bucket_id = 'finance-documents' and (select public.is_owner())$$, null);

-- =====================================================================
-- N) REALTIME
-- =====================================================================
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['finance_accounts', 'finance_categories', 'finance_recurring', 'finance_entries', 'finance_transfers',
      'finance_documents', 'finance_audit_log'] loop
      if not exists (
        select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;
