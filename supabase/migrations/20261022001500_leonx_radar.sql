-- =====================================================================
-- LEONX OS — 015: LEONX AI — Proje ve İş Fırsatı Radarı
--
-- Tablolar (radar_ öneki)
--   radar_settings                 Tek satır: puan ağırlıkları, bildirim tercihleri, arama API bütçesi
--   radar_categories               İş kategorileri (taksonomiden tohumlanır; etkin/ek anahtar sözcük)
--   radar_sources                  Kaynaklar ve izin durumu (yalnız 'izinli' kaynaklar otomatik taranır)
--   radar_source_runs              Tarama çalıştırma kayıtları
--   radar_items                    Kaynak öğeleri (url_hash ile tekil)
--   radar_opportunities            Fırsatlar (cluster_key ile kümelenmiş) ve iş akışı durumu
--   radar_opportunity_categories   Fırsat × kategori (doğrulanmış / potansiyel)
--   radar_evidence                 Her iddianın kanıtı (adres, yayın tarihi, erişim zamanı, alıntı)
--   radar_companies                Kaynaklarda geçen firma/kurum adayları
--   radar_opportunity_companies    Fırsat × firma (rol; doğrulandı mı)
--   radar_contacts                 Kurumsal iletişim kanalları (kaynak adresi + doğrulama zamanı ZORUNLU)
--   radar_actions                  Durum değişikliği geçmişi (tetikleyici yazar)
--   radar_outreach_drafts          E-posta taslakları (OTOMATİK GÖNDERİM YOK)
--   radar_search_usage             Arama API aylık/günlük kullanım sayacı
--
-- Sunucu RPC'leri (yalnız service_role — Edge Function "radar-scan")
--   radar_ingest, radar_service_config, radar_service_claim_sources, radar_service_reserve_search
-- Sahip RPC'leri
--   radar_import_to_crm, radar_add_manual_item, radar_claim_source_test
--
-- Bildirim: mevcut public.notifications / leonx_notify kullanılır; yeni kategori 'firsat'
-- (notification_prefs.cat_firsat). Tekilleştirme anahtarı radar:<fırsat kimliği>.
--
-- Güvenlik: tüm tablolarda RLS açık, erişim yalnız public.is_owner(); anon hiçbir yetkiye sahip değil.
-- Tekrar çalıştırılabilir; tablo/veri silme ifadesi içermez. Mevcut veriye dokunmaz. Sahte fırsat TOHUMLANMAZ.
-- Zamanlayıcı yalnız pg_cron/pg_net varsa ve tarama adresi yapılandırıldıysa istek yapar.
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
-- A) BİLDİRİM KATEGORİSİ 'firsat'
-- =====================================================================
alter table public.notification_prefs add column if not exists cat_firsat boolean not null default true;

-- Kategori kısıtı genişletilir (yalnız izin verilen değer listesine 'firsat' eklenir; satır silinmez)
do $$
declare
  v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint where conrelid = 'public.notifications'::regclass and conname = 'notifications_category_check';
  if v_def is not null and v_def not like '%firsat%' then
    execute 'alter table public.notifications drop constraint notifications_category_check';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.notifications'::regclass and conname = 'notifications_category_check') then
    execute $c$alter table public.notifications add constraint notifications_category_check
      check (category in ('proje', 'teklif', 'cad', 'gorev', 'termin', 'sistem', 'firsat'))$c$;
  end if;
end;
$$;

-- 007'deki gövde AYNEN korunur; yalnız 'firsat' kategorisi tercihi eklenir
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
      when 'gorev' then v_prefs.cat_gorev when 'termin' then v_prefs.cat_termin when 'firsat' then v_prefs.cat_firsat
      else v_prefs.cat_sistem end);
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

-- =====================================================================
-- B) TABLOLAR
-- =====================================================================
create table if not exists public.radar_settings (
  id                     uuid not null unique default gen_random_uuid(),
  singleton              boolean primary key default true check (singleton),
  weights                jsonb not null default '{"kategori":25,"dogrulama":25,"asama":15,"yakinlik":15,"iletisim":10,"ticari":10}'::jsonb
                           check (jsonb_typeof(weights) = 'object'),
  home_city              text not null default 'Ankara' check (char_length(home_city) between 1 and 60),
  min_score              smallint not null default 60 check (min_score between 0 and 100),
  high_priority_score    smallint not null default 75 check (high_priority_score between 0 and 100),
  notify_categories      text[] not null default '{}' check (cardinality(notify_categories) <= 64),
  notify_cities          text[] not null default '{}' check (cardinality(notify_cities) <= 120),
  digest_hour            smallint check (digest_hour is null or digest_hour between 0 and 23),
  quiet_start            smallint check (quiet_start is null or quiet_start between 0 and 23),
  quiet_end              smallint check (quiet_end is null or quiet_end between 0 and 23),
  critical_enabled       boolean not null default true,
  capability_text        text check (capability_text is null or char_length(capability_text) <= 2000),
  -- Arama API (Tavily): varsayılan KAPALI; anahtar yalnız Edge Function gizli değişkeninde
  search_api_enabled     boolean not null default false,
  search_monthly_limit   integer not null default 900 check (search_monthly_limit between 0 and 1000),
  search_daily_limit     integer not null default 30 check (search_daily_limit between 0 and 200),
  search_queries_per_run smallint not null default 2 check (search_queries_per_run between 0 and 10),
  created_by             uuid default auth.uid(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  version                integer not null default 1 check (version >= 1)
);
insert into public.radar_settings (singleton) values (true) on conflict (singleton) do nothing;

create table if not exists public.radar_categories (
  key            text primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  id             uuid not null unique default gen_random_uuid(),
  name           text not null check (char_length(btrim(name)) between 1 and 120),
  group_key      text not null check (group_key in ('kapi', 'aluminyum_pvc', 'metal')),
  sort_order     integer not null default 0,
  active         boolean not null default true,
  extra_keywords text[] not null default '{}' check (cardinality(extra_keywords) <= 30),
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  version        integer not null default 1 check (version >= 1)
);

-- Taksonomi (supabase/functions/_shared/radar/taxonomy.ts ile aynı anahtarlar). Mevcut satırlar korunur.
insert into public.radar_categories (key, name, group_key, sort_order) values
  ('celik_kapi', 'Çelik kapı', 'kapi', 10),
  ('yangin_kapisi', 'Yangın kapısı', 'kapi', 20),
  ('oda_kapisi', 'Oda kapısı', 'kapi', 30),
  ('ahsap_melamin_kapi', 'Ahşap / melamin kapı', 'kapi', 40),
  ('lake_kapi', 'Lake kapı', 'kapi', 50),
  ('bina_giris_kapisi', 'Bina giriş kapısı', 'kapi', 60),
  ('villa_giris_kapisi', 'Villa giriş kapısı', 'kapi', 70),
  ('pivot_kapi', 'Pivot kapı', 'kapi', 80),
  ('teknik_kapi', 'Teknik kapı', 'kapi', 90),
  ('toplu_konut_kapi', 'Toplu konut kapı işleri', 'kapi', 100),
  ('kurumsal_bina_kapi', 'Otel / hastane / okul / ticari bina kapı işleri', 'kapi', 110),
  ('aluminyum_dograma', 'Alüminyum doğrama', 'aluminyum_pvc', 120),
  ('pvc_dograma', 'PVC doğrama', 'aluminyum_pvc', 130),
  ('pencere_kapi_sistemleri', 'Pencere ve kapı sistemleri', 'aluminyum_pvc', 140),
  ('giydirme_cephe', 'Giydirme cephe', 'aluminyum_pvc', 150),
  ('cam_cephe', 'Cam cephe', 'aluminyum_pvc', 160),
  ('kompozit_cephe', 'Kompozit cephe', 'aluminyum_pvc', 170),
  ('aluminyum_korkuluk', 'Alüminyum korkuluk', 'aluminyum_pvc', 180),
  ('kupeste', 'Küpeşte', 'aluminyum_pvc', 190),
  ('surme_sistemleri', 'Sürme sistemleri', 'aluminyum_pvc', 200),
  ('cam_bolme', 'Cam bölme', 'aluminyum_pvc', 210),
  ('ofis_bolme', 'Ofis bölme', 'aluminyum_pvc', 220),
  ('cephe_yenileme', 'Cephe yenileme / tadilat', 'aluminyum_pvc', 230),
  ('lazer_kesim', 'Lazer kesim', 'metal', 240),
  ('plazma_kesim', 'Plazma kesim', 'metal', 250),
  ('boru_profil_lazer', 'Boru-profil lazer', 'metal', 260),
  ('cnc_abkant', 'CNC abkant', 'metal', 270),
  ('delikli_sac', 'Delikli sac', 'metal', 280),
  ('dekoratif_metal_cephe', 'Dekoratif metal cephe', 'metal', 290),
  ('metal_korkuluk', 'Metal korkuluk', 'metal', 300),
  ('ozel_metal_imalat', 'Özel metal imalat', 'metal', 310),
  ('bahce_villa_metal', 'Bahçe ve villa metal ürünleri', 'metal', 320)
on conflict (key) do nothing;

create table if not exists public.radar_sources (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null check (char_length(btrim(name)) between 1 and 200),
  kind                  text not null check (kind in ('rss', 'atom', 'site', 'search_api', 'manual')),
  url                   text check (url is null or (char_length(url) <= 2000 and url ~ '^https://[^\s/]+')),
  allowed_hosts         text[] not null default '{}' check (cardinality(allowed_hosts) <= 10),
  sector_hint           text check (sector_hint is null or sector_hint in ('kamu', 'ozel')),
  region_hint           text check (region_hint is null or char_length(region_hint) <= 100),
  permission_status     text not null default 'inceleniyor' check (permission_status in ('izinli', 'inceleniyor', 'izinsiz')),
  permission_note       text check (permission_note is null or char_length(permission_note) <= 2000),
  permission_checked_at timestamptz,
  interval_minutes      integer not null default 60 check (interval_minutes between 30 and 10080),
  max_items             integer not null default 50 check (max_items between 1 and 200),
  active                boolean not null default false,
  etag                  text check (etag is null or char_length(etag) <= 300),
  last_modified         text check (last_modified is null or char_length(last_modified) <= 100),
  last_run_at           timestamptz,
  last_status           text check (last_status is null or last_status in ('ok', 'degismedi', 'hata', 'atlandi')),
  last_error            text check (last_error is null or char_length(last_error) <= 1000),
  consecutive_failures  integer not null default 0 check (consecutive_failures >= 0),
  next_run_at           timestamptz,
  last_test_at          timestamptz,
  created_by            uuid default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  version               integer not null default 1 check (version >= 1),
  -- İndirilen kaynakların adresi zorunlu
  constraint radar_sources_url_required check (kind in ('manual', 'search_api') or url is not null),
  -- EKAP ve ilan.gov.tr için resmî otomatik erişim izni/API yok: yalnız 'manual' kaynak olarak eklenebilir ve 'izinli' yapılamaz
  constraint radar_sources_no_scrape check (
    url is null
    or url !~* '^https://([a-z0-9-]+\.)*(ekap\.kik\.gov\.tr|ilan\.gov\.tr)(/|$|:|\?)'
    or (kind = 'manual' and permission_status <> 'izinli'))
);
create index if not exists radar_sources_due_idx on public.radar_sources (next_run_at) where active and permission_status = 'izinli';

create table if not exists public.radar_source_runs (
  id            uuid primary key default gen_random_uuid(),
  source_id     uuid not null references public.radar_sources (id) on delete cascade,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  status        text not null check (status in ('ok', 'degismedi', 'hata', 'atlandi')),
  http_status   integer check (http_status is null or http_status between 100 and 599),
  items_seen    integer not null default 0,
  items_new     integer not null default 0,
  items_updated integer not null default 0,
  error         text check (error is null or char_length(error) <= 1000),
  duration_ms   integer check (duration_ms is null or duration_ms >= 0)
);
create index if not exists radar_source_runs_source_idx on public.radar_source_runs (source_id, started_at desc);

create table if not exists public.radar_opportunities (
  id                    uuid primary key default gen_random_uuid(),
  title                 text not null check (char_length(btrim(title)) between 1 and 300),
  city                  text check (city is null or char_length(city) <= 60),
  district              text check (district is null or char_length(district) <= 60),
  is_ankara             boolean not null default false,
  sector                text not null default 'bilinmiyor' check (sector in ('kamu', 'ozel', 'bilinmiyor')),
  project_type          text check (project_type is null or char_length(project_type) <= 40),
  stage                 text not null default 'bilinmiyor' check (stage in ('planlama', 'ihale', 'yapim', 'tamamlandi', 'bilinmiyor')),
  tender                jsonb not null default '{}'::jsonb,
  deadline              date,
  score                 smallint not null default 0 check (score between 0 and 100),
  score_breakdown       jsonb not null default '[]'::jsonb,
  reliability           smallint not null default 0 check (reliability between 0 and 100),
  reliability_base      smallint not null default 0 check (reliability_base between 0 and 100),
  reliability_breakdown jsonb not null default '[]'::jsonb,
  verified_need         boolean not null default false,
  label                 text not null default 'belirsiz' check (label in ('dogrulanmis_firsat', 'potansiyel_ihtiyac', 'belirsiz')),
  risks                 text[] not null default '{}',
  status                text not null default 'yeni' check (status in ('yeni', 'inceleniyor', 'firma_dogrulandi', 'iletisim_planlandi',
                          'iletisime_gecildi', 'teklif_istendi', 'teklif_verildi', 'gorusme', 'kazanildi', 'kaybedildi', 'ilgisiz')),
  status_note           text check (status_note is null or char_length(status_note) <= 1000),
  next_action           text check (next_action is null or char_length(next_action) <= 500),
  cluster_key           text not null unique check (char_length(cluster_key) between 3 and 120),
  cluster_tokens        text[] not null default '{}',
  first_seen_at         timestamptz not null default now(),
  last_updated_at       timestamptz not null default now(),
  notified_at           timestamptz,
  crm_company_id        uuid references public.companies (id) on delete set null,
  project_id            uuid references public.projects (id) on delete set null,
  notes                 text check (notes is null or char_length(notes) <= 5000),
  created_by            uuid default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  version               integer not null default 1 check (version >= 1),
  -- KURAL: doğrulanmış ihtiyaç yoksa "doğrulanmış iş fırsatı" etiketi olamaz
  constraint radar_opportunities_label_rule check (label <> 'dogrulanmis_firsat' or verified_need)
);
create index if not exists radar_opportunities_rank_idx on public.radar_opportunities (is_ankara desc, score desc);
create index if not exists radar_opportunities_pending_idx on public.radar_opportunities (first_seen_at) where notified_at is null;

create table if not exists public.radar_items (
  id             uuid primary key default gen_random_uuid(),
  source_id      uuid references public.radar_sources (id) on delete set null,
  canonical_url  text not null check (char_length(canonical_url) <= 2000 and canonical_url ~* '^https?://'),
  url_hash       text not null unique check (url_hash ~ '^[0-9a-f]{64}$'),
  title          text not null check (char_length(title) between 1 and 300),
  summary        text check (summary is null or char_length(summary) <= 4000),
  raw_text       text check (raw_text is null or char_length(raw_text) <= 20000),
  published_at   timestamptz,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  content_hash   text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  classification jsonb,
  analyzer       text check (analyzer is null or char_length(analyzer) <= 40),
  pending        boolean not null default false,
  opportunity_id uuid references public.radar_opportunities (id) on delete set null
);
create index if not exists radar_items_opportunity_idx on public.radar_items (opportunity_id);
create index if not exists radar_items_pending_idx on public.radar_items (first_seen_at) where pending;

create table if not exists public.radar_opportunity_categories (
  id               uuid primary key default gen_random_uuid(),
  opportunity_id   uuid not null references public.radar_opportunities (id) on delete cascade,
  category_key     text not null references public.radar_categories (key) on delete cascade,
  need_status      text not null check (need_status in ('dogrulanmis', 'potansiyel')),
  matched_terms    text[] not null default '{}',
  evidence_item_id uuid references public.radar_items (id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint radar_opportunity_categories_unique unique (opportunity_id, category_key)
);

create table if not exists public.radar_evidence (
  id             uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.radar_opportunities (id) on delete cascade,
  item_id        uuid references public.radar_items (id) on delete set null,
  field          text not null check (char_length(field) between 1 and 40),
  claim          text not null check (char_length(claim) between 1 and 500),
  excerpt        text check (excerpt is null or char_length(excerpt) <= 500),
  url            text not null check (char_length(url) <= 2000 and url ~* '^https?://'),
  published_at   timestamptz,
  accessed_at    timestamptz not null default now(),
  constraint radar_evidence_unique unique (opportunity_id, item_id, field, claim)
);
create index if not exists radar_evidence_opportunity_idx on public.radar_evidence (opportunity_id);

create table if not exists public.radar_companies (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (char_length(btrim(name)) between 1 and 200),
  normalized_name  text not null unique check (char_length(normalized_name) between 1 and 200),
  website          text check (website is null or (char_length(website) <= 300 and website ~ '^https://[^\s/]+')),
  website_verified boolean not null default false,
  website_source   text check (website_source is null or website_source in ('kanit', 'sahip')),
  crm_company_id   uuid references public.companies (id) on delete set null,
  notes            text check (notes is null or char_length(notes) <= 2000),
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  version          integer not null default 1 check (version >= 1)
);

create table if not exists public.radar_opportunity_companies (
  id               uuid primary key default gen_random_uuid(),
  opportunity_id   uuid not null references public.radar_opportunities (id) on delete cascade,
  company_id       uuid not null references public.radar_companies (id) on delete cascade,
  role             text not null default 'bilinmiyor' check (role in ('yatirimci', 'proje_sahibi', 'ana_yuklenici', 'alt_yuklenici', 'mimar', 'proje_yonetimi', 'bilinmiyor')),
  verified         boolean not null default false,
  evidence_item_id uuid references public.radar_items (id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint radar_opportunity_companies_unique unique (opportunity_id, company_id)
);

create table if not exists public.radar_contacts (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.radar_companies (id) on delete cascade,
  kind        text not null check (kind in ('tedarikci_portali', 'ihale_adresi', 'satinalma_eposta', 'teknik_ofis_eposta', 'genel_eposta', 'telefon', 'iletisim_formu')),
  value       text not null check (char_length(value) between 3 and 500),
  -- Her kanal kaynağıyla ve doğrulama zamanıyla saklanır; adres tahmin edilmez
  source_url  text not null check (char_length(source_url) <= 2000 and source_url ~* '^https?://'),
  verified_at timestamptz not null,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  constraint radar_contacts_unique unique (company_id, kind, value),
  constraint radar_contacts_kind_value_check check (
    (kind in ('satinalma_eposta', 'teknik_ofis_eposta', 'genel_eposta') and value ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
    or (kind = 'telefon' and value ~ '^[+0-9 ()-]{7,25}$')
    or (kind in ('tedarikci_portali', 'ihale_adresi', 'iletisim_formu') and value ~* '^https?://'))
);

create table if not exists public.radar_actions (
  id             bigint generated always as identity primary key,
  opportunity_id uuid not null references public.radar_opportunities (id) on delete cascade,
  from_status    text,
  to_status      text not null,
  note           text check (note is null or char_length(note) <= 1000),
  created_by     uuid,
  created_at     timestamptz not null default now()
);
create index if not exists radar_actions_opportunity_idx on public.radar_actions (opportunity_id, created_at desc);

create table if not exists public.radar_outreach_drafts (
  id             uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.radar_opportunities (id) on delete cascade,
  company_id     uuid references public.radar_companies (id) on delete set null,
  contact_id     uuid references public.radar_contacts (id) on delete set null,
  subject        text not null check (char_length(btrim(subject)) between 1 and 300),
  body           text not null check (char_length(btrim(body)) between 1 and 10000),
  -- 'gonderildi_elle': kullanıcı kendi e-posta istemcisinden gönderdi (sistem GÖNDERMEZ)
  status         text not null default 'taslak' check (status in ('taslak', 'onaylandi', 'gonderildi_elle')),
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  version        integer not null default 1 check (version >= 1)
);

create table if not exists public.radar_search_usage (
  month      date primary key,
  calls      integer not null default 0 check (calls >= 0),
  day        date,
  day_calls  integer not null default 0 check (day_calls >= 0),
  updated_at timestamptz not null default now()
);

-- İstemciye kapalı yapılandırma: tarama işlevinin adresi ve arama imleci
create schema if not exists leonx_private;
revoke all on schema leonx_private from public, anon, authenticated;
create table if not exists leonx_private.radar_config (
  singleton     boolean primary key default true check (singleton),
  scan_url      text check (scan_url is null or scan_url ~ '^https://'),
  search_cursor integer not null default 0,
  updated_at    timestamptz not null default now()
);
revoke all on table leonx_private.radar_config from public, anon, authenticated;
insert into leonx_private.radar_config (singleton) values (true) on conflict (singleton) do nothing;

-- ---------------------------------------------------------------------
-- Ortak tetikleyiciler: created_by / updated_at / version
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['radar_settings', 'radar_categories', 'radar_sources', 'radar_opportunities', 'radar_companies', 'radar_outreach_drafts'] loop
    execute format('create or replace trigger set_created_by before insert on public.%I for each row execute function public.tg_set_created_by()', t);
    execute format('create or replace trigger touch_row before update on public.%I for each row execute function public.tg_touch_row()', t);
  end loop;
end;
$$;

-- Durum değişikliği → radar_actions (geçmiş istemciden yazılamaz)
create or replace function public.tg_radar_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    insert into public.radar_actions (opportunity_id, from_status, to_status, note, created_by)
    values (new.id, old.status, new.status, new.status_note, auth.uid());
  end if;
  return null;
end;
$$;
create or replace trigger radar_status_history
  after update of status on public.radar_opportunities
  for each row execute function public.tg_radar_status();

-- =====================================================================
-- C) BİLDİRİM (radar süzgeçleri leonx_notify'dan ÖNCE uygulanır)
--    • En düşük puan, şehir/ilçe ve kategori tercihleri
--    • Öncelikli (doğrulanmış ihtiyaç + son tarih ≤ 14 gün) → "Öncelikli Teklif Fırsatı", sessiz saatte de
--    • Sessiz saatlerde diğerleri bekletilir; özet saati varsa o saatte tek özet bildirimi
--    • Tekilleştirme: radar:<fırsat kimliği> (aynı fırsat ikinci kez bildirilmez)
-- =====================================================================
create or replace function public.radar_notify_pending()
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
  v_crit  boolean;
  v_cats  text;
  v_body  text;
  v_n     integer := 0;
  v_dig   integer := 0;
begin
  select * into s from public.radar_settings where singleton;
  if not found then return 0; end if;
  v_quiet := s.quiet_start is not null and s.quiet_end is not null and s.quiet_start <> s.quiet_end and (
    case when s.quiet_start < s.quiet_end then v_hour >= s.quiet_start and v_hour < s.quiet_end
         else v_hour >= s.quiet_start or v_hour < s.quiet_end end);
  for r in
    select o.* from public.radar_opportunities o
     where o.notified_at is null
       and o.status not in ('ilgisiz', 'kaybedildi')
       and o.score >= s.min_score
       and o.first_seen_at > now() - interval '14 days'
       and (cardinality(s.notify_cities) = 0 or o.city = any (s.notify_cities) or o.district = any (s.notify_cities))
       and (cardinality(s.notify_categories) = 0 or exists (
             select 1 from public.radar_opportunity_categories c where c.opportunity_id = o.id and c.category_key = any (s.notify_categories)))
     order by o.score desc
     limit 50
  loop
    v_crit := r.verified_need and r.deadline is not null and r.deadline between v_today and v_today + 14;
    select string_agg(k.name, ', ' order by k.sort_order) into v_cats
      from public.radar_opportunity_categories c join public.radar_categories k on k.key = c.category_key
     where c.opportunity_id = r.id and (not r.verified_need or c.need_status = 'dogrulanmis');
    v_body := coalesce(r.city || coalesce(' / ' || r.district, '') || ' · ', '') || 'Puan ' || r.score
      || coalesce(' · ' || v_cats, '') || case when r.deadline is not null then ' · son tarih ' || to_char(r.deadline, 'DD.MM.YYYY') else '' end;
    if v_crit and s.critical_enabled then
      perform public.leonx_notify('firsat', 'radar_oncelikli', 'Öncelikli Teklif Fırsatı: ' || r.title, 'Doğrulanmış iş · ' || v_body,
        '/leonx-ai/firsat/' || r.id, 'radar_opportunity', r.id, 'radar:' || r.id, true);
    elsif v_quiet then
      continue;
    elsif s.digest_hour is not null then
      if v_hour <> s.digest_hour then continue; end if;
      v_dig := v_dig + 1;
    elsif r.verified_need then
      perform public.leonx_notify('firsat', 'radar_dogrulanmis', 'Doğrulanmış iş: ' || r.title, v_body,
        '/leonx-ai/firsat/' || r.id, 'radar_opportunity', r.id, 'radar:' || r.id, true);
    else
      perform public.leonx_notify('firsat', 'radar_potansiyel', 'Potansiyel ihtiyaç (doğrulanmadı): ' || r.title, v_body,
        '/leonx-ai/firsat/' || r.id, 'radar_opportunity', r.id, 'radar:' || r.id, true);
    end if;
    update public.radar_opportunities set notified_at = now() where id = r.id;
    v_n := v_n + 1;
  end loop;
  if v_dig > 0 then
    perform public.leonx_notify('firsat', 'radar_ozet', 'LEONX Radar günlük özeti: ' || v_dig || ' yeni fırsat',
      'Ayrıntılar LEONX AI panelinde', '/leonx-ai', null, null, 'radar:ozet:' || v_today, true);
  end if;
  return v_n;
end;
$$;

-- =====================================================================
-- D) SUNUCU TARAFI YAZMA (yalnız service_role — Edge Function "radar-scan")
-- =====================================================================
create or replace function public.radar_ingest(p_source uuid, p_run jsonb, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_src      public.radar_sources;
  v_status   text := coalesce(p_run ->> 'status', 'ok');
  v_run_id   uuid;
  v_item     jsonb;
  v_x        jsonb;
  v_existing public.radar_items;
  v_item_id  uuid;
  v_opp      public.radar_opportunities;
  v_cid      uuid;
  v_new      integer := 0;
  v_upd      integer := 0;
  v_seen     integer := 0;
  v_score    integer;
  v_relbase  integer;
  v_title    text;
  v_city     text;
  v_stage    text;
  v_label    text;
  v_risks    text[];
  v_terms    text[];
  v_role     text;
  v_nsrc     integer;
  v_pub      timestamptz;
  v_failures integer;
begin
  select * into v_src from public.radar_sources where id = p_source for update;
  if not found then raise exception 'Kaynak bulunamadı' using errcode = 'P0002'; end if;
  if v_status not in ('ok', 'degismedi', 'hata', 'atlandi') then raise exception 'Geçersiz çalıştırma durumu' using errcode = '22023'; end if;
  if p_items is not null and (jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 200) then
    raise exception 'Öğe listesi geçersiz (en çok 200)' using errcode = '22023';
  end if;
  begin
    v_run_id := coalesce((p_run ->> 'id')::uuid, gen_random_uuid());
  exception when invalid_text_representation then
    v_run_id := gen_random_uuid();
  end;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_seen := v_seen + 1;
    -- Doğrulama: geçersiz öğe atlanır (çalıştırma düşmez)
    if coalesce(v_item ->> 'url_hash', '') !~ '^[0-9a-f]{64}$' or coalesce(v_item ->> 'content_hash', '') !~ '^[0-9a-f]{64}$'
       or coalesce(v_item ->> 'canonical_url', '') !~* '^https?://' or char_length(v_item ->> 'canonical_url') > 2000
       or coalesce(v_item ->> 'cluster_key', '') = '' or char_length(v_item ->> 'cluster_key') > 120 then
      continue;
    end if;
    v_title := left(btrim(coalesce(nullif(v_item ->> 'title', ''), '(başlıksız)')), 300);
    v_pub := null;
    begin
      v_pub := (v_item ->> 'published_at')::timestamptz;
    exception when others then
      v_pub := null;
    end;
    v_item_id := null;

    if v_item ? 'pending_item_id' then
      -- Elle eklenmiş öğenin sınıflandırılması
      update public.radar_items set
        title = v_title, summary = left(v_item ->> 'summary', 4000), content_hash = v_item ->> 'content_hash',
        classification = v_item -> 'classification', analyzer = left(v_item ->> 'analyzer', 40), pending = false, last_seen_at = now()
      where id = (v_item ->> 'pending_item_id')::uuid and pending
      returning id into v_item_id;
      if v_item_id is null then continue; end if;
      v_new := v_new + 1;
    else
      select * into v_existing from public.radar_items where url_hash = v_item ->> 'url_hash' for update;
      if found then
        if v_existing.content_hash = v_item ->> 'content_hash' and not v_existing.pending then
          -- Aynı öğe yeniden görüldü: yalnız last_seen
          update public.radar_items set last_seen_at = now() where id = v_existing.id;
          continue;
        end if;
        update public.radar_items set
          title = v_title, summary = left(v_item ->> 'summary', 4000), published_at = coalesce(v_pub, published_at),
          content_hash = v_item ->> 'content_hash', classification = v_item -> 'classification',
          analyzer = left(v_item ->> 'analyzer', 40), pending = false, last_seen_at = now()
        where id = v_existing.id;
        v_item_id := v_existing.id;
        v_upd := v_upd + 1;
      else
        insert into public.radar_items (source_id, canonical_url, url_hash, title, summary, published_at, content_hash, classification, analyzer)
        values (p_source, v_item ->> 'canonical_url', v_item ->> 'url_hash', v_title, left(v_item ->> 'summary', 4000), v_pub,
                v_item ->> 'content_hash', v_item -> 'classification', left(v_item ->> 'analyzer', 40))
        returning id into v_item_id;
        v_new := v_new + 1;
      end if;
    end if;

    -- Fırsat birleştirme (cluster_key)
    v_score := greatest(0, least(100, coalesce((v_item ->> 'score')::numeric, 0)::integer));
    v_relbase := greatest(0, least(100, coalesce((v_item ->> 'reliability_base')::numeric, 0)::integer));
    v_city := nullif(left(v_item ->> 'city', 60), '');
    v_stage := case when v_item ->> 'stage' in ('planlama', 'ihale', 'yapim', 'tamamlandi') then v_item ->> 'stage' else 'bilinmiyor' end;
    v_risks := array(select left(x, 40) from jsonb_array_elements_text(coalesce(v_item -> 'risks', '[]'::jsonb)) x limit 20);
    v_label := case when coalesce((v_item ->> 'verified_need')::boolean, false) then 'dogrulanmis_firsat'
                    when jsonb_array_length(coalesce(v_item -> 'categories', '[]'::jsonb)) > 0 then 'potansiyel_ihtiyac' else 'belirsiz' end;
    select * into v_opp from public.radar_opportunities where cluster_key = v_item ->> 'cluster_key' for update;
    if not found then
      insert into public.radar_opportunities (title, city, district, is_ankara, sector, project_type, stage, tender, deadline, score,
        score_breakdown, reliability, reliability_base, reliability_breakdown, verified_need, label, risks, cluster_key, cluster_tokens)
      values (v_title, v_city, nullif(left(v_item ->> 'district', 60), ''), coalesce((v_item ->> 'is_ankara')::boolean, false),
        case when v_item ->> 'sector' in ('kamu', 'ozel') then v_item ->> 'sector' else 'bilinmiyor' end,
        nullif(left(v_item ->> 'project_type', 40), ''), v_stage, coalesce(v_item -> 'tender', '{}'::jsonb),
        case when coalesce(v_item ->> 'deadline', '') ~ '^\d{4}-\d{2}-\d{2}$' then (v_item ->> 'deadline')::date end,
        v_score, coalesce(v_item -> 'score_breakdown', '[]'::jsonb), v_relbase, v_relbase, coalesce(v_item -> 'reliability_breakdown', '[]'::jsonb),
        coalesce((v_item ->> 'verified_need')::boolean, false), v_label, v_risks, v_item ->> 'cluster_key',
        array(select left(x, 60) from jsonb_array_elements_text(coalesce(v_item -> 'cluster_tokens', '[]'::jsonb)) x limit 12))
      returning * into v_opp;
    else
      -- Kaynak çelişkisi: farklı şehir veya tamamlandı ↔ ihale/planlama
      if (v_opp.city is not null and v_city is not null and v_opp.city <> v_city)
         or (v_opp.stage = 'tamamlandi' and v_stage in ('ihale', 'planlama'))
         or (v_stage = 'tamamlandi' and v_opp.stage in ('ihale', 'planlama')) then
        v_risks := v_risks || array['kaynak_celiskisi'];
      end if;
      update public.radar_opportunities o set
        city = coalesce(o.city, v_city),
        district = coalesce(o.district, nullif(left(v_item ->> 'district', 60), '')),
        is_ankara = o.is_ankara or coalesce((v_item ->> 'is_ankara')::boolean, false),
        sector = case when o.sector = 'bilinmiyor' and v_item ->> 'sector' in ('kamu', 'ozel') then v_item ->> 'sector' else o.sector end,
        project_type = coalesce(o.project_type, nullif(left(v_item ->> 'project_type', 40), '')),
        stage = case when v_stage = 'ihale' then 'ihale' when o.stage = 'bilinmiyor' then v_stage else o.stage end,
        tender = o.tender || jsonb_strip_nulls(coalesce(v_item -> 'tender', '{}'::jsonb)),
        deadline = coalesce(case when coalesce(v_item ->> 'deadline', '') ~ '^\d{4}-\d{2}-\d{2}$' then (v_item ->> 'deadline')::date end, o.deadline),
        score = greatest(o.score, v_score),
        score_breakdown = case when v_score > o.score then coalesce(v_item -> 'score_breakdown', o.score_breakdown) else o.score_breakdown end,
        reliability_base = greatest(o.reliability_base, v_relbase),
        reliability_breakdown = case when v_relbase > o.reliability_base then coalesce(v_item -> 'reliability_breakdown', o.reliability_breakdown) else o.reliability_breakdown end,
        verified_need = o.verified_need or coalesce((v_item ->> 'verified_need')::boolean, false),
        label = case when o.verified_need or coalesce((v_item ->> 'verified_need')::boolean, false) then 'dogrulanmis_firsat'
                     when o.label = 'potansiyel_ihtiyac' or v_label = 'potansiyel_ihtiyac' then 'potansiyel_ihtiyac' else 'belirsiz' end,
        risks = array(select distinct x from unnest(o.risks || v_risks) x),
        last_updated_at = now()
      where o.id = v_opp.id
      returning * into v_opp;
    end if;
    update public.radar_items set opportunity_id = v_opp.id where id = v_item_id;

    -- Kategoriler (doğrulanmış bir kez kazanılınca potansiyele düşmez)
    for v_x in select * from jsonb_array_elements(coalesce(v_item -> 'categories', '[]'::jsonb)) loop
      if not exists (select 1 from public.radar_categories where key = v_x ->> 'key') or coalesce(v_x ->> 'need_status', '') not in ('dogrulanmis', 'potansiyel') then
        continue;
      end if;
      v_terms := array(select left(x, 120) from jsonb_array_elements_text(coalesce(v_x -> 'matched_terms', '[]'::jsonb)) x limit 10);
      insert into public.radar_opportunity_categories as c (opportunity_id, category_key, need_status, matched_terms, evidence_item_id)
      values (v_opp.id, v_x ->> 'key', v_x ->> 'need_status', v_terms, v_item_id)
      on conflict (opportunity_id, category_key) do update set
        need_status = case when excluded.need_status = 'dogrulanmis' or c.need_status = 'dogrulanmis' then 'dogrulanmis' else 'potansiyel' end,
        matched_terms = array(select distinct x from unnest(c.matched_terms || excluded.matched_terms) x limit 20),
        evidence_item_id = case when excluded.need_status = 'dogrulanmis' and c.need_status <> 'dogrulanmis' then excluded.evidence_item_id else c.evidence_item_id end;
    end loop;

    -- Kanıtlar
    for v_x in select * from jsonb_array_elements(coalesce(v_item -> 'evidence', '[]'::jsonb)) loop
      if coalesce(btrim(v_x ->> 'claim'), '') = '' then continue; end if;
      insert into public.radar_evidence (opportunity_id, item_id, field, claim, excerpt, url, published_at, accessed_at)
      values (v_opp.id, v_item_id, left(coalesce(nullif(v_x ->> 'field', ''), 'kaynak'), 40), left(v_x ->> 'claim', 500),
              left(v_x ->> 'excerpt', 500), v_item ->> 'canonical_url', v_pub, now())
      on conflict (opportunity_id, item_id, field, claim) do nothing;
    end loop;

    -- Firma / kurum adayları (rol tahmini, DOĞRULANMAMIŞ)
    for v_x in select * from jsonb_array_elements(coalesce(v_item -> 'companies', '[]'::jsonb)) loop
      if coalesce(btrim(v_x ->> 'name'), '') = '' or coalesce(btrim(v_x ->> 'normalized_name'), '') = '' then continue; end if;
      insert into public.radar_companies (name, normalized_name)
      values (left(btrim(v_x ->> 'name'), 200), left(btrim(v_x ->> 'normalized_name'), 200))
      on conflict (normalized_name) do nothing;
      select id into v_cid from public.radar_companies where normalized_name = left(btrim(v_x ->> 'normalized_name'), 200);
      v_role := case when v_x ->> 'role' in ('yatirimci', 'proje_sahibi', 'ana_yuklenici', 'alt_yuklenici', 'mimar', 'proje_yonetimi') then v_x ->> 'role' else 'bilinmiyor' end;
      insert into public.radar_opportunity_companies (opportunity_id, company_id, role, verified, evidence_item_id)
      values (v_opp.id, v_cid, v_role, false, v_item_id)
      on conflict (opportunity_id, company_id) do nothing;
    end loop;

    -- Güvenilirlik: taban + farklı kaynak teyidi (score.ts corroborationPoints ile aynı tablo)
    select count(distinct i.source_id) into v_nsrc from public.radar_items i where i.opportunity_id = v_opp.id;
    update public.radar_opportunities
       set reliability = least(100, reliability_base + case when v_nsrc >= 3 then 25 when v_nsrc = 2 then 15 else 0 end)
     where id = v_opp.id;
  end loop;

  -- Çalıştırma kaydı (toplu çağrılarda aynı kimlik birikir)
  insert into public.radar_source_runs as r (id, source_id, started_at, finished_at, status, http_status, items_seen, items_new, items_updated, error, duration_ms)
  values (v_run_id, p_source, coalesce((p_run ->> 'started_at')::timestamptz, now()), coalesce((p_run ->> 'finished_at')::timestamptz, now()), v_status,
          case when (p_run ->> 'http_status') ~ '^\d{3}$' then (p_run ->> 'http_status')::integer end,
          v_seen, v_new, v_upd, left(p_run ->> 'error', 1000),
          case when (p_run ->> 'duration_ms') ~ '^\d{1,9}$' then (p_run ->> 'duration_ms')::integer end)
  on conflict (id) do update set
    finished_at = excluded.finished_at, items_seen = r.items_seen + excluded.items_seen, items_new = r.items_new + excluded.items_new,
    items_updated = r.items_updated + excluded.items_updated, duration_ms = excluded.duration_ms,
    status = case when r.status = 'hata' then 'hata' else excluded.status end;

  -- Kaynak durumu ve geri çekilme: hata → şimdi + min(24 sa, aralık × 2^ardışık hata)
  v_failures := case when v_status = 'hata' then v_src.consecutive_failures + 1 else 0 end;
  if v_src.kind <> 'manual' then
    update public.radar_sources set
      last_run_at = now(), last_status = v_status, last_error = left(p_run ->> 'error', 1000),
      etag = case when v_status in ('ok', 'degismedi') then coalesce(left(p_run ->> 'etag', 300), etag) else etag end,
      last_modified = case when v_status in ('ok', 'degismedi') then coalesce(left(p_run ->> 'last_modified', 100), last_modified) else last_modified end,
      consecutive_failures = v_failures,
      next_run_at = now() + case when v_status = 'hata'
                                 then least(interval '24 hours', make_interval(mins => interval_minutes) * power(2, least(v_failures, 10)))
                                 else make_interval(mins => interval_minutes) end
    where id = p_source;
  end if;

  perform public.radar_notify_pending();
  return jsonb_build_object('items_new', v_new, 'items_updated', v_upd, 'items_seen', v_seen);
end;
$$;

-- Edge Function kimlik doğrulaması: zamanlayıcı gizli başlığı (push-dispatch ile aynı gizli değer)
create or replace function public.radar_service_config()
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  select jsonb_build_object('cron_secret', (select cron_secret from leonx_private.push_config where singleton));
$$;

-- Zamanı gelen, ETKİN ve 'izinli' kaynakları kiralar (15 dk; aynı kaynak eşzamanlı iki kez alınmaz)
create or replace function public.radar_service_claim_sources(p_limit integer)
returns setof public.radar_sources
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with picked as (
    select id from public.radar_sources
     where active and permission_status = 'izinli' and kind in ('rss', 'atom', 'site', 'search_api')
       and (next_run_at is null or next_run_at <= now())
     order by next_run_at nulls first
     limit greatest(1, least(coalesce(p_limit, 10), 20))
     for update skip locked
  )
  update public.radar_sources s set next_run_at = now() + interval '15 minutes'
    from picked where s.id = picked.id
  returning s.*;
end;
$$;

-- Arama API bütçesi: her çağrıdan ÖNCE atomik ayırma (aylık + günlük sınır, ayar kapalıysa ret)
create or replace function public.radar_service_reserve_search()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s       public.radar_settings;
  u       public.radar_search_usage;
  v_month date := date_trunc('month', (now() at time zone 'Europe/Istanbul'))::date;
  v_day   date := (now() at time zone 'Europe/Istanbul')::date;
  v_cur   integer;
begin
  select * into s from public.radar_settings where singleton;
  if not found or not s.search_api_enabled then
    return jsonb_build_object('granted', false, 'reason', 'Arama API ayarlarda kapalı', 'cursor', 0);
  end if;
  insert into public.radar_search_usage (month) values (v_month) on conflict (month) do nothing;
  select * into u from public.radar_search_usage where month = v_month for update;
  if u.calls >= s.search_monthly_limit then
    return jsonb_build_object('granted', false, 'reason', 'aylık arama bütçesi doldu', 'cursor', 0);
  end if;
  if u.day = v_day and u.day_calls >= s.search_daily_limit then
    return jsonb_build_object('granted', false, 'reason', 'günlük arama sınırı doldu', 'cursor', 0);
  end if;
  update public.radar_search_usage
     set calls = calls + 1, day_calls = case when day = v_day then day_calls + 1 else 1 end, day = v_day, updated_at = now()
   where month = v_month;
  update leonx_private.radar_config set search_cursor = search_cursor + 1, updated_at = now() where singleton
  returning search_cursor - 1 into v_cur;
  return jsonb_build_object('granted', true, 'reason', null, 'cursor', coalesce(v_cur, 0), 'used', u.calls + 1, 'limit', s.search_monthly_limit);
end;
$$;

-- Zamanlayıcıdan tarama işlevini çağırır (adres yapılandırılmamışsa hiçbir şey yapmaz)
create or replace function leonx_private.dispatch_radar()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
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
  using v_url, '{}'::jsonb, jsonb_build_object('Content-Type', 'application/json', 'x-leonx-cron', v_secret);
end;
$$;
revoke all on function leonx_private.dispatch_radar() from public;

-- =====================================================================
-- E) SAHİP RPC'LERİ
-- =====================================================================

-- "Kaynağı test et" hız sınırı: kaynak başına 5 dakikada bir
create or replace function public.radar_claim_source_test(p_source uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  if not public.is_owner() then raise exception 'Yetkisiz' using errcode = '42501'; end if;
  update public.radar_sources set last_test_at = now()
   where id = p_source and (last_test_at is null or last_test_at < now() - interval '5 minutes')
  returning true into v_ok;
  return coalesce(v_ok, false);
end;
$$;

-- Elle bağlantı / not ekleme: metin SUNUCUDA temizlenir, öğe "bekliyor" olarak kaydedilir ve tarama işlevi
-- (yapılandırılmışsa) hemen tetiklenir. Adres İNDİRİLMEZ; yalnız sahibin yapıştırdığı metin sınıflandırılır.
create or replace function public.radar_add_manual_item(p_url text, p_title text, p_text text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text := btrim(coalesce(p_url, ''));
  v_canon  text;
  v_title  text;
  v_text   text;
  v_src    uuid;
  v_id     uuid;
  v_hash   text;
  v_ex     public.radar_items;
begin
  if not public.is_owner() then raise exception 'Yetkisiz' using errcode = '42501'; end if;
  if v_url !~* '^https?://[^\s/?#]+\.[^\s/?#]+([/?#]\S*)?$' or char_length(v_url) > 2000 then
    raise exception 'Geçerli bir http(s) adresi girin' using errcode = '23514';
  end if;
  -- Temizleme: betik/stil blokları, etiketler, yaygın varlıklar; boşluk sıkıştırma; uzunluk sınırı
  v_text := coalesce(p_text, '');
  v_text := regexp_replace(v_text, '<(script|style|iframe|object|embed)[^>]*>.*?</\1\s*>', ' ', 'gis');
  v_text := regexp_replace(v_text, '<!--.*?-->', ' ', 'gs');
  v_text := regexp_replace(v_text, '<[^>]*>', ' ', 'g');
  v_text := replace(replace(replace(replace(replace(replace(v_text, '&nbsp;', ' '), '&lt;', '<'), '&gt;', '>'), '&quot;', '"'), '&#39;', ''''), '&amp;', '&');
  v_text := regexp_replace(v_text, '[\u0001-\u0008\u000B\u000C\u000E-\u001F]', ' ', 'g');
  v_text := left(btrim(regexp_replace(v_text, '\s+', ' ', 'g')), 20000);
  v_title := regexp_replace(coalesce(p_title, ''), '<[^>]*>', ' ', 'g');
  v_title := left(btrim(regexp_replace(v_title, '\s+', ' ', 'g')), 300);
  if v_title = '' then v_title := left(v_text, 200); end if;
  if v_title = '' then raise exception 'Başlık veya metin girin' using errcode = '23514'; end if;
  v_canon := regexp_replace(v_url, '#.*$', '');
  v_hash := encode(sha256(convert_to(v_canon, 'UTF8')), 'hex');

  select * into v_ex from public.radar_items where url_hash = v_hash;
  if found then
    if v_ex.pending then
      update public.radar_items set title = v_title, raw_text = nullif(v_text, ''), summary = left(nullif(v_text, ''), 4000) where id = v_ex.id;
    end if;
    return v_ex.id;
  end if;

  select id into v_src from public.radar_sources where kind = 'manual' and url is null order by created_at, id limit 1;
  if v_src is null then
    insert into public.radar_sources (name, kind, permission_status, permission_note, active)
    values ('Elle eklenen bağlantılar', 'manual', 'inceleniyor', 'Sahibin elle eklediği bağlantı ve notlar; otomatik indirilmez.', false)
    returning id into v_src;
  end if;
  insert into public.radar_items (source_id, canonical_url, url_hash, title, summary, raw_text, content_hash, pending)
  values (v_src, v_canon, v_hash, v_title, left(nullif(v_text, ''), 4000), nullif(v_text, ''),
          encode(sha256(convert_to(v_title || E'\n' || v_text, 'UTF8')), 'hex'), true)
  returning id into v_id;
  perform leonx_private.dispatch_radar();
  return v_id;
end;
$$;

-- Fırsattan CRM'e aktarma (yalnız sahip tetikler; yalnız radar_companies verisi kullanılır; tekrarlanabilir)
create or replace function public.radar_import_to_crm(p_opportunity uuid, p_company uuid, p_create_project boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_opp     public.radar_opportunities;
  v_rc      public.radar_companies;
  v_company uuid;
  v_project uuid;
  v_email   text;
  v_phone   text;
  v_url     text;
  v_cat     text;
  v_code    text;
  v_try     integer := 0;
begin
  if not public.is_owner() then raise exception 'Yetkisiz' using errcode = '42501'; end if;
  select * into v_opp from public.radar_opportunities where id = p_opportunity for update;
  if not found then raise exception 'Fırsat bulunamadı' using errcode = 'P0002'; end if;
  select url into v_url from public.radar_evidence where opportunity_id = v_opp.id order by accessed_at, id limit 1;

  if p_company is not null then
    select * into v_rc from public.radar_companies where id = p_company for update;
    if not found or not exists (select 1 from public.radar_opportunity_companies where opportunity_id = v_opp.id and company_id = p_company) then
      raise exception 'Firma bu fırsatla ilişkili değil' using errcode = 'P0002';
    end if;
    if v_rc.crm_company_id is not null and exists (select 1 from public.companies where id = v_rc.crm_company_id) then
      v_company := v_rc.crm_company_id;
    else
      -- Yalnız doğrulanmış (kaynaklı) kurumsal kanallar aktarılır; adres üretilmez
      select value into v_email from public.radar_contacts
       where company_id = v_rc.id and kind in ('satinalma_eposta', 'genel_eposta', 'teknik_ofis_eposta') and char_length(value) <= 254
       order by case kind when 'satinalma_eposta' then 1 when 'genel_eposta' then 2 else 3 end, created_at limit 1;
      select value into v_phone from public.radar_contacts
       where company_id = v_rc.id and kind = 'telefon' and char_length(value) <= 40 order by created_at limit 1;
      insert into public.companies (name, email, phone, notes)
      values (left(v_rc.name, 200), v_email, v_phone,
              left('LEONX Radar fırsatından aktarıldı.' || coalesce(E'\nWeb sitesi: ' || v_rc.website, '') || coalesce(E'\nKaynak: ' || v_url, ''), 5000))
      returning id into v_company;
      update public.radar_companies set crm_company_id = v_company where id = v_rc.id;
    end if;
    if v_opp.crm_company_id is null then
      update public.radar_opportunities set crm_company_id = v_company where id = v_opp.id;
    end if;
  end if;

  if coalesce(p_create_project, false) then
    if v_opp.project_id is not null and exists (select 1 from public.projects where id = v_opp.project_id) then
      v_project := v_opp.project_id;
    else
      select case
               when c.category_key = 'yangin_kapisi' then 'yangin_kapisi'
               when c.category_key in ('oda_kapisi', 'ahsap_melamin_kapi', 'lake_kapi') then 'oda_kapisi'
               when c.category_key in ('celik_kapi', 'bina_giris_kapisi', 'villa_giris_kapisi', 'pivot_kapi', 'teknik_kapi', 'toplu_konut_kapi', 'kurumsal_bina_kapi') then 'celik_kapi'
               when c.category_key in ('aluminyum_dograma', 'pencere_kapi_sistemleri', 'surme_sistemleri') then 'aluminyum_dograma'
               when c.category_key = 'pvc_dograma' then 'pvc_dograma'
               when c.category_key in ('giydirme_cephe', 'cam_cephe', 'kompozit_cephe', 'cephe_yenileme', 'dekoratif_metal_cephe') then 'cephe'
               when c.category_key in ('aluminyum_korkuluk', 'kupeste', 'metal_korkuluk') then 'korkuluk'
               when c.category_key in ('lazer_kesim', 'plazma_kesim', 'boru_profil_lazer', 'cnc_abkant', 'delikli_sac', 'ozel_metal_imalat', 'bahce_villa_metal') then 'metal_imalat'
               else 'diger' end
        into v_cat
        from public.radar_opportunity_categories c join public.radar_categories k on k.key = c.category_key
       where c.opportunity_id = v_opp.id
       order by (c.need_status = 'dogrulanmis') desc, k.sort_order
       limit 1;
      loop
        v_try := v_try + 1;
        v_code := public.suggest_project_code();
        begin
          insert into public.projects (code, name, category, company_id, stage, location, description)
          values (v_code, left(v_opp.title, 200), coalesce(v_cat, 'diger'), coalesce(v_company, v_opp.crm_company_id), 'yeni_firsat',
                  nullif(left(concat_ws(' / ', v_opp.district, v_opp.city), 300), ''),
                  left('LEONX Radar proje adayı (doğrulanmamış veriler kaynaklarıyla birlikte radar raporundadır).' || coalesce(E'\nKaynak: ' || v_url, ''), 5000))
          returning id into v_project;
          exit;
        exception when unique_violation then
          if v_try >= 5 then raise; end if;
        end;
      end loop;
      update public.radar_opportunities set project_id = v_project where id = v_opp.id;
    end if;
  end if;
  return jsonb_build_object('company_id', v_company, 'project_id', v_project);
end;
$$;

-- =====================================================================
-- F) FONKSİYON YETKİLERİ
-- =====================================================================
revoke all on function public.tg_radar_status() from public, anon, authenticated;
revoke all on function public.radar_notify_pending() from public, anon, authenticated;
do $$
declare
  f text;
begin
  foreach f in array array['public.radar_ingest(uuid, jsonb, jsonb)', 'public.radar_service_config()',
    'public.radar_service_claim_sources(integer)', 'public.radar_service_reserve_search()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end;
$$;
revoke all on function public.radar_claim_source_test(uuid) from public, anon;
revoke all on function public.radar_add_manual_item(text, text, text) from public, anon;
revoke all on function public.radar_import_to_crm(uuid, uuid, boolean) from public, anon;
grant execute on function public.radar_claim_source_test(uuid) to authenticated;
grant execute on function public.radar_add_manual_item(text, text, text) to authenticated;
grant execute on function public.radar_import_to_crm(uuid, uuid, boolean) to authenticated;

-- =====================================================================
-- G) TABLO YETKİLERİ VE RLS
-- =====================================================================
revoke all on table public.radar_settings, public.radar_categories, public.radar_sources, public.radar_source_runs, public.radar_items,
  public.radar_opportunities, public.radar_opportunity_categories, public.radar_evidence, public.radar_companies,
  public.radar_opportunity_companies, public.radar_contacts, public.radar_actions, public.radar_outreach_drafts, public.radar_search_usage
  from anon, authenticated;
grant select on table public.radar_settings, public.radar_categories, public.radar_sources, public.radar_source_runs, public.radar_items,
  public.radar_opportunities, public.radar_opportunity_categories, public.radar_evidence, public.radar_companies,
  public.radar_opportunity_companies, public.radar_contacts, public.radar_actions, public.radar_outreach_drafts, public.radar_search_usage
  to authenticated;
grant update (weights, home_city, min_score, high_priority_score, notify_categories, notify_cities, digest_hour, quiet_start, quiet_end,
  critical_enabled, capability_text, search_api_enabled, search_monthly_limit, search_daily_limit, search_queries_per_run)
  on table public.radar_settings to authenticated;
grant update (active, extra_keywords) on table public.radar_categories to authenticated;
grant insert (id, name, kind, url, allowed_hosts, sector_hint, region_hint, permission_status, permission_note, permission_checked_at, interval_minutes, max_items, active)
  on table public.radar_sources to authenticated;
grant update (name, kind, url, allowed_hosts, sector_hint, region_hint, permission_status, permission_note, permission_checked_at, interval_minutes, max_items, active)
  on table public.radar_sources to authenticated;
grant delete on table public.radar_sources to authenticated;
grant update (status, status_note, next_action, notes) on table public.radar_opportunities to authenticated;
grant update (website, website_verified, website_source, notes) on table public.radar_companies to authenticated;
grant update (role, verified) on table public.radar_opportunity_companies to authenticated;
grant insert, update, delete on table public.radar_contacts to authenticated;
grant insert, update, delete on table public.radar_outreach_drafts to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update on table public.radar_settings, public.radar_categories, public.radar_sources, public.radar_source_runs, public.radar_items,
      public.radar_opportunities, public.radar_opportunity_categories, public.radar_evidence, public.radar_companies,
      public.radar_opportunity_companies, public.radar_contacts, public.radar_actions, public.radar_outreach_drafts, public.radar_search_usage
      to service_role;
  end if;
end;
$$;

alter table public.radar_settings               enable row level security;
alter table public.radar_categories             enable row level security;
alter table public.radar_sources                enable row level security;
alter table public.radar_source_runs            enable row level security;
alter table public.radar_items                  enable row level security;
alter table public.radar_opportunities          enable row level security;
alter table public.radar_opportunity_categories enable row level security;
alter table public.radar_evidence               enable row level security;
alter table public.radar_companies              enable row level security;
alter table public.radar_opportunity_companies  enable row level security;
alter table public.radar_contacts               enable row level security;
alter table public.radar_actions                enable row level security;
alter table public.radar_outreach_drafts        enable row level security;
alter table public.radar_search_usage           enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['radar_settings', 'radar_categories', 'radar_sources', 'radar_source_runs', 'radar_items', 'radar_opportunities',
    'radar_opportunity_categories', 'radar_evidence', 'radar_companies', 'radar_opportunity_companies', 'radar_contacts', 'radar_actions',
    'radar_outreach_drafts', 'radar_search_usage'] loop
    perform pg_temp.leonx_policy('public', t, 'owner_select', 'select', '(select public.is_owner())', null);
  end loop;
  foreach t in array array['radar_settings', 'radar_categories', 'radar_sources', 'radar_opportunities', 'radar_companies',
    'radar_opportunity_companies', 'radar_contacts', 'radar_outreach_drafts'] loop
    perform pg_temp.leonx_policy('public', t, 'owner_update', 'update', '(select public.is_owner())', '(select public.is_owner())');
  end loop;
  foreach t in array array['radar_sources', 'radar_contacts', 'radar_outreach_drafts'] loop
    perform pg_temp.leonx_policy('public', t, 'owner_insert', 'insert', null, '(select public.is_owner())');
    perform pg_temp.leonx_policy('public', t, 'owner_delete', 'delete', '(select public.is_owner())', null);
  end loop;
end;
$$;

-- =====================================================================
-- H) REALTIME (radar_items hariç: hacimli ve yalnız sunucu yazar)
-- =====================================================================
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['radar_settings', 'radar_categories', 'radar_sources', 'radar_source_runs', 'radar_opportunities',
      'radar_opportunity_categories', 'radar_evidence', 'radar_companies', 'radar_opportunity_companies', 'radar_contacts',
      'radar_actions', 'radar_outreach_drafts', 'radar_search_usage'] loop
      if not exists (
        select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;

-- =====================================================================
-- I) ZAMANLAYICI (008 ile aynı koruma: eklentiler yoksa atlanır; adres yoksa istek yapılmaz)
--    Kurulum (dağıtımdan SONRA, SQL Editor):
--      update leonx_private.radar_config set scan_url = 'https://<proje>.supabase.co/functions/v1/radar-scan' where singleton;
-- =====================================================================
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net') then
    raise notice 'pg_cron / pg_net bulunamadı; radar zamanlayıcısı kurulmadı.';
    return;
  end if;
  execute 'create schema if not exists extensions';
  execute 'create extension if not exists pg_net with schema extensions';
  execute 'create extension if not exists pg_cron';
  execute $q$select cron.schedule('leonx-radar', '17 * * * *', 'select leonx_private.dispatch_radar()')$q$;
  execute $q$select cron.schedule('leonx-radar-bildirim', '5 * * * *', 'select public.radar_notify_pending()')$q$;
end;
$$;
