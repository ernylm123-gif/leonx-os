-- =====================================================================
-- LEONX OS — 011: Finans, maliyet, tahsilat ve kârlılık (Faz 8)
--
-- Tablolar
--   cost_rates                Birim maliyet kataloğu (kullanıcı tanımlar; sistem fiyat uydurmaz)
--   fx_rates                  Kullanıcının girdiği kurlar (yalnız bunlarla çevrim yapılır)
--   project_budgets           Proje bütçesi: KDV hariç satış, KDV, kabul edilen teklif anlık görüntüsü, fire/genel gider
--   project_cost_lines        Tahmini maliyet satırları (elle / onaylı metrajdan / oran)
--   project_expenses          Gerçekleşen giderler (KDV hariç tutar + KDV ayrı)
--   project_payment_schedule  Ödeme planı (peşinat, ara ödeme, son ödeme, taksit)
--   project_collections       Tahsilatlar
-- Görünüm
--   project_receivables       Taksit bazında tahsil edilen / kalan / durum (security_invoker: RLS geçerli)
--
-- Kurallar (veritabanında uygulanır, istemciye güvenilmez)
--   • Farklı para birimleri yalnız kullanıcının girdiği kurla çevrilir; kur yoksa toplam üretilmez.
--   • Metrajdan maliyete yalnız ONAYLI sürümün ONAYLI pozları aktarılır; aynı poz aynı maliyet grubuna
--     ikinci kez eklenemez ve bir projeye iki farklı metraj revizyonu aktarılamaz (çift sayım engeli).
--   • Bütçe yalnız kabul edilmiş teklife bağlanabilir; teklif tutarı anlık görüntü olarak saklanır.
--   • Tahsilat, bağlandığı taksitle aynı proje ve para biriminde olmalıdır.
--   • Bütçe aşımı (tahmini toplam maliyet tam ve çevrilebilir olduğunda) her %10'luk eşikte bir kez bildirilir.
--   • Tahsilat vadesi yaklaşıyor / gecikti hatırlatmaları mevcut hatırlatma taramasına eklenir (tekilleştirilmiş).
--
-- Güvenlik: tüm tablolarda RLS açık, erişim yalnızca public.is_owner(). anon hiçbir yetkiye sahip değil.
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
-- A) BİRİM MALİYET KATALOĞU
-- =====================================================================
create table if not exists public.cost_rates (
  id                uuid primary key default gen_random_uuid(),
  code              text not null check (code ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$'),
  name              text not null check (char_length(btrim(name)) between 1 and 200),
  cost_group        text not null check (cost_group in (
                      'profil', 'pvc_sistem', 'cam', 'aksesuar', 'iscilik', 'uretim', 'montaj', 'nakliye',
                      'taseron', 'fire', 'genel_gider', 'diger')),
  unit              text not null check (unit in ('m2', 'mtul', 'adet', 'kg', 'saat', 'goturu', 'm')),
  currency          text not null default 'TRY' check (currency in ('TRY', 'EUR', 'USD')),
  unit_cost         numeric(14, 2) not null check (unit_cost > 0 and unit_cost <= 999999999999),
  -- Metraj iş grubu (src/quantity/types.ts QUANTITY_CATEGORIES); boşsa otomatik öneride kullanılmaz
  quantity_category text check (quantity_category is null or quantity_category in (
                      'al_pencere', 'al_kapi', 'pvc_pencere', 'pvc_kapi', 'surme', 'sabit_cam', 'cephe_dograma',
                      'fotoselli_kapi', 'korkuluk', 'kompozit_cephe', 'metal_imalat', 'belirsiz')),
  valid_from        date not null default current_date,
  active            boolean not null default true,
  notes             text check (notes is null or char_length(notes) <= 2000),
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  version           integer not null default 1 check (version >= 1),
  -- Aynı kodun fiyat geçmişi: her geçerlilik tarihi için tek fiyat
  constraint cost_rates_code_valid_unique unique (code, valid_from)
);
create index if not exists cost_rates_category_idx on public.cost_rates (quantity_category) where active;

-- =====================================================================
-- B) KURLAR (yalnız kullanıcının girdiği, kaynağı belirtilmiş kurlar)
-- =====================================================================
create table if not exists public.fx_rates (
  id            uuid primary key default gen_random_uuid(),
  rate_date     date not null,
  from_currency text not null check (from_currency in ('TRY', 'EUR', 'USD')),
  to_currency   text not null check (to_currency in ('TRY', 'EUR', 'USD')),
  rate          numeric(18, 6) not null check (rate > 0 and rate < 1000000000),
  -- Boşsa genel kur; doluysa yalnız o projede kullanılır (projeye özel kur önceliklidir)
  project_id    uuid references public.projects (id) on delete cascade,
  source        text not null check (char_length(btrim(source)) between 1 and 200),
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  version       integer not null default 1 check (version >= 1),
  constraint fx_rates_pair_check check (from_currency <> to_currency)
);
create unique index if not exists fx_rates_unique_idx
  on public.fx_rates (rate_date, from_currency, to_currency, coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists fx_rates_lookup_idx on public.fx_rates (from_currency, to_currency, rate_date desc);

-- =====================================================================
-- C) PROJE BÜTÇESİ (proje başına tek satır)
-- =====================================================================
create table if not exists public.project_budgets (
  id                      uuid primary key default gen_random_uuid(),
  project_id              uuid not null unique references public.projects (id) on delete cascade,
  -- Ana para birimi: kârlılık ve toplamlar bu birimde (çevrim yalnız girilen kurla)
  currency                text not null default 'TRY' check (currency in ('TRY', 'EUR', 'USD')),
  -- KDV hariç sözleşme / teklif bedeli (bilinmiyorsa boş; uydurulmaz)
  sale_net_amount         numeric(14, 2) check (sale_net_amount is null or (sale_net_amount >= 0 and sale_net_amount <= 999999999999)),
  vat_pct                 numeric(7, 3) not null default 20 check (vat_pct between 0 and 100),
  source_quote_id         uuid references public.quotes (id) on delete set null,
  quote_snapshot_net      numeric(14, 2) check (quote_snapshot_net is null or (quote_snapshot_net >= 0 and quote_snapshot_net <= 999999999999)),
  quote_snapshot_currency text check (quote_snapshot_currency is null or quote_snapshot_currency in ('TRY', 'EUR', 'USD')),
  quote_snapshot_vat_pct  numeric(7, 3) check (quote_snapshot_vat_pct is null or quote_snapshot_vat_pct between 0 and 100),
  quote_snapshot_label    text check (quote_snapshot_label is null or char_length(quote_snapshot_label) <= 200),
  quote_snapshot_at       timestamptz,
  -- Fire yalnız malzeme gruplarına (profil, PVC sistem, cam, aksesuar), genel gider tüm doğrudan maliyete uygulanır
  waste_pct               numeric(7, 3) not null default 0 check (waste_pct between 0 and 100),
  overhead_pct            numeric(7, 3) not null default 0 check (overhead_pct between 0 and 500),
  notes                   text check (notes is null or char_length(notes) <= 5000),
  created_by              uuid default auth.uid(),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  version                 integer not null default 1 check (version >= 1)
);

-- =====================================================================
-- D) TAHMİNİ MALİYET SATIRLARI
-- =====================================================================
create table if not exists public.project_cost_lines (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects (id) on delete cascade,
  sort_order        integer not null default 0,
  cost_group        text not null check (cost_group in (
                      'profil', 'pvc_sistem', 'cam', 'aksesuar', 'iscilik', 'uretim', 'montaj', 'nakliye',
                      'taseron', 'fire', 'genel_gider', 'diger')),
  description       text not null check (char_length(btrim(description)) between 1 and 500),
  quantity          numeric(14, 3) not null check (quantity > 0 and quantity <= 1000000000),
  unit              text not null check (unit in ('m2', 'mtul', 'adet', 'kg', 'saat', 'goturu', 'm')),
  -- Boş: "fiyat tanımlanmamış" (toplamlara katılmaz, uyarı gösterilir). Sıfır varsayılmaz.
  unit_cost         numeric(14, 2) check (unit_cost is null or (unit_cost >= 0 and unit_cost <= 999999999999)),
  currency          text not null default 'TRY' check (currency in ('TRY', 'EUR', 'USD')),
  source            text not null default 'elle' check (source in ('elle', 'metraj', 'oran')),
  source_takeoff_id uuid references public.quantity_takeoffs (id) on delete set null,
  source_item_id    uuid references public.quantity_items (id) on delete set null,
  cost_rate_id      uuid references public.cost_rates (id) on delete set null,
  -- Miktarın neye dayandığı: alan, cam alanı, çevre (profil boyu DEĞİL; tahmini), uzunluk, adet, kg
  measure_basis     text check (measure_basis is null or measure_basis in ('alan', 'cam_alani', 'cevre', 'uzunluk', 'adet', 'kg')),
  notes             text check (notes is null or char_length(notes) <= 2000),
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  version           integer not null default 1 check (version >= 1)
);
create index if not exists project_cost_lines_project_idx on public.project_cost_lines (project_id, sort_order);
-- Çift sayım engeli: aynı metraj pozu aynı maliyet grubuna bir kez
create unique index if not exists project_cost_lines_source_unique
  on public.project_cost_lines (project_id, source_item_id, cost_group) where source_item_id is not null;

-- =====================================================================
-- E) GERÇEKLEŞEN GİDERLER
-- =====================================================================
create table if not exists public.project_expenses (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects (id) on delete cascade,
  expense_date    date not null,
  cost_group      text not null check (cost_group in (
                    'profil', 'pvc_sistem', 'cam', 'aksesuar', 'iscilik', 'uretim', 'montaj', 'nakliye',
                    'taseron', 'fire', 'genel_gider', 'diger')),
  description     text not null check (char_length(btrim(description)) between 1 and 500),
  supplier        text check (supplier is null or char_length(supplier) <= 200),
  -- KDV hariç tutar; KDV ayrı (kâr KDV hariç tutarlardan hesaplanır)
  amount          numeric(14, 2) not null check (amount > 0 and amount <= 999999999999),
  vat_amount      numeric(14, 2) not null default 0 check (vat_amount >= 0 and vat_amount <= 999999999999),
  currency        text not null default 'TRY' check (currency in ('TRY', 'EUR', 'USD')),
  -- Faturadaki kur (isteğe bağlı): fx_to_currency birimine çevrim; yoksa kur tablosu kullanılır
  fx_rate_to_base numeric(18, 6) check (fx_rate_to_base is null or (fx_rate_to_base > 0 and fx_rate_to_base < 1000000000)),
  fx_to_currency  text check (fx_to_currency is null or fx_to_currency in ('TRY', 'EUR', 'USD')),
  document_no     text check (document_no is null or char_length(document_no) <= 80),
  paid            boolean not null default false,
  notes           text check (notes is null or char_length(notes) <= 2000),
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  version         integer not null default 1 check (version >= 1),
  constraint project_expenses_fx_check check (
    (fx_rate_to_base is null and fx_to_currency is null)
    or (fx_rate_to_base is not null and fx_to_currency is not null and fx_to_currency <> currency))
);
create index if not exists project_expenses_project_idx on public.project_expenses (project_id, expense_date desc);
-- Aynı tedarikçinin aynı belge numarası bir projede iki kez gider yazılamaz
create unique index if not exists project_expenses_document_unique
  on public.project_expenses (project_id, coalesce(lower(supplier), ''), lower(document_no)) where document_no is not null;

-- =====================================================================
-- F) ÖDEME PLANI VE TAHSİLATLAR
-- =====================================================================
create table if not exists public.project_payment_schedule (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  kind        text not null default 'taksit' check (kind in ('pesinat', 'ara_odeme', 'son_odeme', 'taksit')),
  label       text check (label is null or char_length(label) <= 200),
  due_date    date not null,
  -- Müşterinin ödeyeceği tutar (KDV dahil olabilir; sözleşmeye göre)
  amount      numeric(14, 2) not null check (amount > 0 and amount <= 999999999999),
  currency    text not null default 'TRY' check (currency in ('TRY', 'EUR', 'USD')),
  sort_order  integer not null default 0,
  notes       text check (notes is null or char_length(notes) <= 2000),
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  version     integer not null default 1 check (version >= 1)
);
create index if not exists project_payment_schedule_project_idx on public.project_payment_schedule (project_id, due_date);

create table if not exists public.project_collections (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  received_date date not null,
  amount        numeric(14, 2) not null check (amount > 0 and amount <= 999999999999),
  currency      text not null default 'TRY' check (currency in ('TRY', 'EUR', 'USD')),
  method        text not null default 'havale' check (method in ('nakit', 'havale', 'cek', 'senet', 'kredi_karti', 'diger')),
  schedule_id   uuid references public.project_payment_schedule (id) on delete set null,
  reference     text check (reference is null or char_length(reference) <= 120),
  note          text check (note is null or char_length(note) <= 2000),
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  version       integer not null default 1 check (version >= 1)
);
create index if not exists project_collections_project_idx on public.project_collections (project_id, received_date desc);
create index if not exists project_collections_schedule_idx on public.project_collections (schedule_id);

-- ---------------------------------------------------------------------
-- Ortak tetikleyiciler: created_by / updated_at / version
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['cost_rates', 'fx_rates', 'project_budgets', 'project_cost_lines', 'project_expenses',
    'project_payment_schedule', 'project_collections'] loop
    execute format('create or replace trigger set_created_by before insert on public.%I for each row execute function public.tg_set_created_by()', t);
    execute format('create or replace trigger touch_row before update on public.%I for each row execute function public.tg_touch_row()', t);
  end loop;
end;
$$;

-- =====================================================================
-- G) KUR SEÇİMİ
--   Aynı para birimi → 1. Aksi hâlde yalnız kullanıcının girdiği kur: tarih ≤ işlem tarihi,
--   projeye özel kur genelden önce, en yeni tarih önce. Ters yön hesaplanmaz. Kur yoksa NULL.
--   (İstemci: src/finance/fx.ts pickRate — aynı sıralama)
-- =====================================================================
create or replace function public.leonx_fx_rate(p_from text, p_to text, p_date date, p_project uuid)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select case when p_from = p_to then 1::numeric else (
    select r.rate
      from public.fx_rates r
     where r.from_currency = p_from and r.to_currency = p_to and r.rate_date <= p_date
       and (r.project_id is null or r.project_id = p_project)
     order by (r.project_id is not null) desc, r.rate_date desc, r.created_at desc, r.id desc
     limit 1) end;
$$;

-- =====================================================================
-- H) BÜTÜNLÜK KURALLARI
-- =====================================================================

-- Tahmini maliyet: metraj bağlantısı yalnız onaylı sürüm + onaylı poz; tek metraj revizyonu
create or replace function public.tg_fin_cost_line_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status  text;
  v_project uuid;
  v_ver     text;
  v_takeoff uuid;
begin
  -- Yabancı anahtar eylemi (metraj sürümü/pozu silinince bağlantı boşalır): izinli
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.project_id is distinct from old.project_id then
    raise exception 'Maliyet satırı başka projeye taşınamaz' using errcode = 'check_violation';
  end if;
  if new.source <> 'metraj' then
    if new.source_item_id is not null or new.source_takeoff_id is not null then
      raise exception 'Metraj bağlantısı yalnız metraj kaynaklı satırda olabilir' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and new.source_item_id is not distinct from old.source_item_id
     and new.source_takeoff_id is not distinct from old.source_takeoff_id and old.source = 'metraj' then
    return new;
  end if;
  if new.source_item_id is null or new.source_takeoff_id is null then
    raise exception 'Metraj kaynaklı satır için metraj sürümü ve poz gereklidir' using errcode = 'check_violation';
  end if;
  select status, project_id into v_status, v_project from public.quantity_takeoffs where id = new.source_takeoff_id;
  if v_project is null or v_project <> new.project_id then
    raise exception 'Metraj sürümü bu projeye ait değil' using errcode = 'check_violation';
  end if;
  if v_status <> 'onaylandi' then
    raise exception 'Yalnız onaylanmış metraj sürümü maliyete aktarılabilir' using errcode = 'check_violation';
  end if;
  select verification, takeoff_id into v_ver, v_takeoff from public.quantity_items where id = new.source_item_id;
  if v_takeoff is distinct from new.source_takeoff_id then
    raise exception 'Poz bu metraj sürümüne ait değil' using errcode = 'check_violation';
  end if;
  if v_ver <> 'onaylandi' then
    raise exception 'Doğrulanmamış veya reddedilmiş poz maliyete aktarılamaz' using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.project_cost_lines l
     where l.project_id = new.project_id and l.source = 'metraj' and l.source_takeoff_id is not null
       and l.source_takeoff_id <> new.source_takeoff_id and l.id <> new.id
  ) then
    raise exception 'Bu projeye başka bir metraj revizyonu aktarılmış; çift sayımı önlemek için önce o satırları kaldırın'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create or replace trigger fin_cost_line_guard
  before insert or update on public.project_cost_lines
  for each row execute function public.tg_fin_cost_line_guard();

-- Bütçe: yalnız aynı projenin kabul edilmiş teklifine bağlanır
create or replace function public.tg_fin_budget_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status  text;
  v_project uuid;
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.project_id is distinct from old.project_id then
    raise exception 'Bütçe başka projeye taşınamaz' using errcode = 'check_violation';
  end if;
  if new.source_quote_id is not null and (tg_op = 'INSERT' or new.source_quote_id is distinct from old.source_quote_id) then
    select status, project_id into v_status, v_project from public.quotes where id = new.source_quote_id;
    if v_project is distinct from new.project_id then
      raise exception 'Teklif bu projeye bağlı değil' using errcode = 'check_violation';
    end if;
    if v_status <> 'kabul' then
      raise exception 'Bütçe yalnız kabul edilmiş teklife bağlanabilir' using errcode = 'check_violation';
    end if;
  end if;
  if new.source_quote_id is null and new.quote_snapshot_net is not null and (tg_op = 'INSERT' or old.source_quote_id is null) then
    raise exception 'Teklif anlık görüntüsü teklif bağlantısı olmadan yazılamaz' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create or replace trigger fin_budget_guard
  before insert or update on public.project_budgets
  for each row execute function public.tg_fin_budget_guard();

-- Tahsilat: bağlandığı taksitle aynı proje ve para birimi
create or replace function public.tg_fin_collection_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_project  uuid;
  v_currency text;
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.project_id is distinct from old.project_id then
    raise exception 'Tahsilat başka projeye taşınamaz' using errcode = 'check_violation';
  end if;
  if new.schedule_id is not null then
    select project_id, currency into v_project, v_currency from public.project_payment_schedule where id = new.schedule_id;
    if v_project is distinct from new.project_id then
      raise exception 'Taksit bu projeye ait değil' using errcode = 'check_violation';
    end if;
    if v_currency <> new.currency then
      raise exception 'Tahsilat, bağlandığı taksitle aynı para biriminde olmalıdır' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
create or replace trigger fin_collection_guard
  before insert or update on public.project_collections
  for each row execute function public.tg_fin_collection_guard();

-- Diğer satırlar da proje değiştiremez
create or replace function public.tg_fin_project_lock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.project_id is distinct from old.project_id then
    raise exception 'Kayıt başka projeye taşınamaz' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create or replace trigger fin_project_lock before update on public.project_expenses
  for each row execute function public.tg_fin_project_lock();
create or replace trigger fin_project_lock before update on public.project_payment_schedule
  for each row execute function public.tg_fin_project_lock();

-- =====================================================================
-- I) TAHSİLAT DURUMU (görünüm)
--   Önce taksite bağlı tahsilatlar uygulanır; bağlanmamış tahsilatlar ve taksiti aşan kısım
--   aynı para birimindeki en eski açık taksitlere sırayla (FIFO) dağıtılır. Kalan asla negatif olmaz.
--   (İstemci: src/finance/receivables.ts — aynı algoritma)
-- =====================================================================
create or replace view public.project_receivables
with (security_invoker = true)
as
with s as (
  select ps.id, ps.project_id, ps.kind, ps.label, ps.due_date, ps.amount, ps.currency, ps.sort_order,
         coalesce((select sum(c.amount) from public.project_collections c where c.schedule_id = ps.id), 0) as linked
    from public.project_payment_schedule ps
),
pool as (
  select x.project_id, x.currency, sum(x.amount) as amount
    from (
      select c.project_id, c.currency, c.amount from public.project_collections c where c.schedule_id is null
      union all
      select s.project_id, s.currency, greatest(s.linked - s.amount, 0) from s
    ) x
   group by x.project_id, x.currency
),
r as (
  select s.*,
         least(s.linked, s.amount) as linked_applied,
         s.amount - least(s.linked, s.amount) as open_after_linked,
         coalesce(sum(s.amount - least(s.linked, s.amount)) over (
           partition by s.project_id, s.currency order by s.due_date, s.sort_order, s.id
           rows between unbounded preceding and 1 preceding), 0) as open_before
    from s
),
a as (
  select r.*,
         r.linked_applied + least(r.open_after_linked, greatest(coalesce(p.amount, 0) - r.open_before, 0)) as collected
    from r
    left join pool p on p.project_id = r.project_id and p.currency = r.currency
)
select a.id, a.project_id, a.kind, a.label, a.due_date, a.amount, a.currency, a.sort_order,
       a.collected,
       a.amount - a.collected as outstanding,
       case
         when a.amount - a.collected = 0 then 'tahsil_edildi'
         when a.due_date < (now() at time zone 'Europe/Istanbul')::date then 'gecikti'
         when a.collected > 0 then 'kismi'
         else 'bekliyor'
       end as status
  from a;

-- =====================================================================
-- J) BÜTÇE AŞIMI KONTROLÜ
--   Tahmini toplam = satırlar (ana para birimine çevrilmiş) + fire (malzeme) + genel gider.
--   Fiyatı tanımlanmamış veya kuru girilmemiş satır varsa tahmin eksiktir → bildirim üretilmez.
--   Gerçekleşen = çevrilebilen giderlerin KDV hariç toplamı. Her %10'luk aşım eşiğinde bir kez bildirilir.
--   (İstemci: src/finance/estimate.ts — aynı yuvarlama: satır = round(miktar × birim, 2), çevrim = round(tutar × kur, 2))
-- =====================================================================
create or replace function public.leonx_finance_budget_check(p_project uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base     text;
  v_waste    numeric;
  v_over     numeric;
  v_today    date := (now() at time zone 'Europe/Istanbul')::date;
  v_direct   numeric := 0;
  v_material numeric := 0;
  v_waste_a  numeric;
  v_est      numeric;
  v_act      numeric := 0;
  v_rate     numeric;
  v_step     integer;
  v_code     text;
  v_detail   text;
  r          record;
begin
  if p_project is null then return; end if;
  select currency, waste_pct, overhead_pct into v_base, v_waste, v_over from public.project_budgets where project_id = p_project;
  v_base := coalesce(v_base, 'TRY');
  v_waste := coalesce(v_waste, 0);
  v_over := coalesce(v_over, 0);
  if not exists (select 1 from public.project_cost_lines where project_id = p_project) then
    return;
  end if;
  for r in select * from public.project_cost_lines where project_id = p_project loop
    if r.unit_cost is null then
      return;
    end if;
    v_rate := public.leonx_fx_rate(r.currency, v_base, v_today, p_project);
    if v_rate is null then
      return;
    end if;
    v_direct := v_direct + round(round(r.quantity * r.unit_cost, 2) * v_rate, 2);
    if r.cost_group in ('profil', 'pvc_sistem', 'cam', 'aksesuar') then
      v_material := v_material + round(round(r.quantity * r.unit_cost, 2) * v_rate, 2);
    end if;
  end loop;
  v_waste_a := round(v_material * v_waste / 100, 2);
  v_est := v_direct + v_waste_a + round((v_direct + v_waste_a) * v_over / 100, 2);
  if v_est <= 0 then
    return;
  end if;
  for r in select * from public.project_expenses where project_id = p_project loop
    if r.currency = v_base then
      v_rate := 1;
    elsif r.fx_rate_to_base is not null and r.fx_to_currency = v_base then
      v_rate := r.fx_rate_to_base;
    else
      v_rate := public.leonx_fx_rate(r.currency, v_base, r.expense_date, p_project);
    end if;
    if v_rate is not null then
      v_act := v_act + round(r.amount * v_rate, 2);
    end if;
  end loop;
  if v_act <= v_est then
    return;
  end if;
  v_step := floor((v_act - v_est) * 10 / v_est)::integer;
  select code into v_code from public.projects where id = p_project;
  v_detail := 'Gerçekleşen gider ' || to_char(v_act, 'FM999999999990.00') || ' ' || v_base
    || ' · tahmini maliyet ' || to_char(v_est, 'FM999999999990.00') || ' ' || v_base
    || ' (%' || to_char(round((v_act - v_est) * 100 / v_est, 1), 'FM9999990.0') || ' aşım)';
  perform public.leonx_event(p_project, 'butce_asildi', 'Bütçe aşıldı', v_detail, 'project', p_project,
    'butce-asildi:' || p_project || ':' || v_step);
  perform public.leonx_notify('proje', 'butce_asildi', 'Bütçe aşıldı: ' || coalesce(v_code, ''), v_detail,
    '/projeler/' || p_project || '?sekme=finans', 'project', p_project, 'butce-asildi:' || p_project || ':' || v_step, true);
end;
$$;

-- Gider: zaman çizelgesi + bütçe kontrolü
create or replace function public.tg_fin_expense()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.leonx_event(new.project_id, 'gider', 'Gider kaydedildi',
      new.description || ' · ' || to_char(new.amount, 'FM999999999990.00') || ' ' || new.currency || ' (KDV hariç)',
      'expense', new.id, 'expense:' || new.id);
  end if;
  perform public.leonx_finance_budget_check(new.project_id);
  return null;
end;
$$;
create or replace trigger fin_expense
  after insert or update on public.project_expenses
  for each row execute function public.tg_fin_expense();

-- Tahsilat: zaman çizelgesi
create or replace function public.tg_fin_collection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.leonx_event(new.project_id, 'tahsilat', 'Tahsilat kaydedildi',
    to_char(new.amount, 'FM999999999990.00') || ' ' || new.currency || ' · ' || to_char(new.received_date, 'DD.MM.YYYY'),
    'collection', new.id, 'collection:' || new.id);
  return null;
end;
$$;
create or replace trigger fin_collection
  after insert on public.project_collections
  for each row execute function public.tg_fin_collection();

-- =====================================================================
-- K) ZAMANLANMIŞ HATIRLATMALAR — 007'deki gövde AYNEN korunur; tahsilat vadeleri eklenir
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
  -- Faz 8: tahsilat vadesi yaklaşıyor (3 gün) / gecikti — yalnız kalan tutarı olan taksitler (iptal projeler hariç)
  for r in select v.*, p.code from public.project_receivables v join public.projects p on p.id = v.project_id
           where v.outstanding > 0 and p.stage <> 'iptal' and v.due_date between v_today - 90 and v_today + 3 loop
    if r.due_date >= v_today then
      perform public.leonx_notify('termin', 'tahsilat_yaklasiyor', 'Tahsilat vadesi yaklaşıyor: ' || r.code,
        coalesce(r.label || ' · ', '') || to_char(r.outstanding, 'FM999999999990.00') || ' ' || r.currency || ' · ' || to_char(r.due_date, 'DD.MM.YYYY'),
        '/projeler/' || r.project_id || '?sekme=finans', 'project', r.project_id, 'tahsilat-yaklasiyor:' || r.id || ':' || r.due_date, true);
    else
      perform public.leonx_notify('termin', 'tahsilat_gecikti', 'Tahsilat gecikti: ' || r.code,
        coalesce(r.label || ' · ', '') || to_char(r.outstanding, 'FM999999999990.00') || ' ' || r.currency || ' · vade ' || to_char(r.due_date, 'DD.MM.YYYY'),
        '/projeler/' || r.project_id || '?sekme=finans', 'project', r.project_id, 'tahsilat-gecikti:' || r.id, true);
    end if;
  end loop;
  return (select count(*) from public.notifications) - v_before;
end;
$$;
revoke all on function public.leonx_run_reminders() from public, anon, authenticated;

-- =====================================================================
-- L) FONKSİYON YETKİLERİ (tetikleyici ve iç fonksiyonlar istemciden çağrılamaz)
-- =====================================================================
do $$
declare
  f text;
begin
  foreach f in array array['tg_fin_cost_line_guard', 'tg_fin_budget_guard', 'tg_fin_collection_guard', 'tg_fin_project_lock',
    'tg_fin_expense', 'tg_fin_collection'] loop
    execute format('revoke all on function public.%I() from public, anon, authenticated', f);
  end loop;
end;
$$;
revoke all on function public.leonx_finance_budget_check(uuid) from public, anon, authenticated;
revoke all on function public.leonx_fx_rate(text, text, date, uuid) from public, anon;
grant execute on function public.leonx_fx_rate(text, text, date, uuid) to authenticated;

-- =====================================================================
-- M) YETKİLER VE RLS
-- =====================================================================
revoke all on table public.cost_rates, public.fx_rates, public.project_budgets, public.project_cost_lines,
  public.project_expenses, public.project_payment_schedule, public.project_collections, public.project_receivables from anon;
revoke all on table public.cost_rates, public.fx_rates, public.project_budgets, public.project_cost_lines,
  public.project_expenses, public.project_payment_schedule, public.project_collections, public.project_receivables from authenticated;
grant select, insert, update, delete on table public.cost_rates, public.fx_rates, public.project_budgets, public.project_cost_lines,
  public.project_expenses, public.project_payment_schedule, public.project_collections to authenticated;
grant select on table public.project_receivables to authenticated;

alter table public.cost_rates               enable row level security;
alter table public.fx_rates                 enable row level security;
alter table public.project_budgets          enable row level security;
alter table public.project_cost_lines       enable row level security;
alter table public.project_expenses         enable row level security;
alter table public.project_payment_schedule enable row level security;
alter table public.project_collections      enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['cost_rates', 'fx_rates', 'project_budgets', 'project_cost_lines', 'project_expenses',
    'project_payment_schedule', 'project_collections'] loop
    perform pg_temp.leonx_policy('public', t, 'owner_select', 'select', '(select public.is_owner())', null);
    perform pg_temp.leonx_policy('public', t, 'owner_insert', 'insert', null, '(select public.is_owner())');
    perform pg_temp.leonx_policy('public', t, 'owner_update', 'update', '(select public.is_owner())', '(select public.is_owner())');
    perform pg_temp.leonx_policy('public', t, 'owner_delete', 'delete', '(select public.is_owner())', null);
  end loop;
end;
$$;

-- =====================================================================
-- N) REALTIME
-- =====================================================================
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['cost_rates', 'fx_rates', 'project_budgets', 'project_cost_lines', 'project_expenses',
      'project_payment_schedule', 'project_collections'] loop
      if not exists (
        select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;
