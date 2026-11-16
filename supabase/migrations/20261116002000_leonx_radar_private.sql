-- =====================================================================
-- LEONX OS â€” 020: Ã–zel sektÃ¶r inÅŸaat keÅŸfi, yÃ¼klenici dizini, kanÄ±tlÄ± aÅŸama, ÅŸeffaf puan ve
--                 proje bazlÄ± e-posta kuyruÄŸu
--   A) Ayarlar: keÅŸif (arama API), firma sitesi izleme, e-posta kuyruÄŸu ve OTOMATÄ°K GÃ–NDERÄ°M (varsayÄ±lan
--      KAPALI; Gmail baÄŸlantÄ±sÄ± + hukuki dayanak belgelenmeden aÃ§Ä±lamaz â€” veritabanÄ± kÄ±sÄ±tÄ±).
--   B) YÃ¼klenici dizini (radar_companies geniÅŸletilir): sektÃ¶r, Ã¶lÃ§ek, tÃ¼r, ilÃ§eler, keÅŸif kaynaÄŸÄ±,
--      izleme Ã¶nceliÄŸi, son/sonraki araÅŸtÄ±rma, ret listesi.
--   C) FÄ±rsat (radar_opportunities geniÅŸletilir): Ã¶zel sektÃ¶r puanÄ± ve dÃ¶kÃ¼mÃ¼, satÄ±ÅŸ bÃ¶lÃ¼mleri, kanÄ±tlÄ±
--      aÅŸama (kanÄ±t adresi, yayÄ±n tarihi, doÄŸrulama zamanÄ±, gÃ¼ven, aÃ§Ä±klama), daire sayÄ±sÄ±, Ã¶lÃ§ek.
--   D) KeÅŸif kayÄ±tlarÄ±: sorgu rotasyonu (radar_discovery_queries), gÃ¶rÃ¼len sonuÃ§lar (tekilleÅŸtirme ve
--      artÄ±mlÄ± keÅŸif â€” radar_discovery_seen), her Ã§alÄ±ÅŸtÄ±rmanÄ±n dÃ¼rÃ¼st durumu (radar_discovery_runs).
--   E) E-posta: taslaklara inceleme kuyruÄŸu/uygunluk/yanÄ±t durumu; gerÃ§ek gÃ¶nderimler ayrÄ± ve yalnÄ±z
--      sunucunun yazdÄ±ÄŸÄ± defterde (radar_outreach_sends); ret (listeden Ã§Ä±kma) listesi.
--   F) Sunucu iÅŸlevleri, ilÃ§e kapsamÄ±, Ã¶zel sektÃ¶r paneli Ã¶zeti, saatlik keÅŸif zamanlayÄ±cÄ±sÄ±.
-- 015â€“019'a baÄŸlÄ±dÄ±r. Tekrar Ã§alÄ±ÅŸtÄ±rÄ±labilir; tablo veya veri SÄ°LMEZ (yalnÄ±z ekler/geniÅŸletir).
-- =====================================================================

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
-- A) AYARLAR
-- =====================================================================
alter table public.radar_settings add column if not exists discovery_enabled boolean not null default false;
alter table public.radar_settings add column if not exists discovery_queries_per_run smallint not null default 1;
alter table public.radar_settings add column if not exists company_monitoring_enabled boolean not null default false;
alter table public.radar_settings add column if not exists company_pages_per_run smallint not null default 2;
alter table public.radar_settings add column if not exists outreach_min_score smallint not null default 55;
alter table public.radar_settings add column if not exists outreach_auto_send boolean not null default false;
alter table public.radar_settings add column if not exists outreach_daily_limit smallint not null default 10;
alter table public.radar_settings add column if not exists outreach_legal_note text;
alter table public.radar_settings add column if not exists outreach_legal_confirmed_at timestamptz;
alter table public.radar_settings add column if not exists gmail_sender text not null default 'erlindoorkapi@gmail.com';
alter table public.radar_settings add column if not exists gmail_verified_at timestamptz;
alter table public.radar_settings add column if not exists gmail_last_check jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'radar_settings_private_check') then
    alter table public.radar_settings add constraint radar_settings_private_check check (
      discovery_queries_per_run between 0 and 10
      and company_pages_per_run between 0 and 10
      and outreach_min_score between 0 and 100
      and outreach_daily_limit between 0 and 50
      and (outreach_legal_note is null or char_length(outreach_legal_note) <= 2000)
      -- GÃ¶nderen hesap sabittir; Claude hesabÄ± veya baÅŸka bir adres kullanÄ±lamaz
      and gmail_sender = 'erlindoorkapi@gmail.com');
  end if;
  -- Otomatik gÃ¶nderim: Gmail baÄŸlantÄ±sÄ± sunucuda doÄŸrulanmadan ve hukuki dayanak belgelenmeden aÃ§Ä±lamaz
  if not exists (select 1 from pg_constraint where conname = 'radar_settings_auto_send_check') then
    alter table public.radar_settings add constraint radar_settings_auto_send_check check (
      not outreach_auto_send
      or (gmail_verified_at is not null and outreach_legal_confirmed_at is not null and coalesce(btrim(outreach_legal_note), '') <> ''));
  end if;
end;
$$;
grant update (discovery_enabled, discovery_queries_per_run, company_monitoring_enabled, company_pages_per_run, outreach_min_score,
  outreach_auto_send, outreach_daily_limit, outreach_legal_note, outreach_legal_confirmed_at)
  on table public.radar_settings to authenticated;

-- =====================================================================
-- B) YÃœKLENÄ°CÄ° DÄ°ZÄ°NÄ°
-- =====================================================================
alter table public.radar_companies add column if not exists sector text;
alter table public.radar_companies add column if not exists size_band text;
alter table public.radar_companies add column if not exists contractor_kind text;
alter table public.radar_companies add column if not exists districts text[] not null default '{}';
alter table public.radar_companies add column if not exists cities text[] not null default '{}';
alter table public.radar_companies add column if not exists name_basis text;
alter table public.radar_companies add column if not exists discovery_source text;
alter table public.radar_companies add column if not exists discovery_url text;
alter table public.radar_companies add column if not exists discovery_query text;
alter table public.radar_companies add column if not exists first_discovered_at timestamptz;
alter table public.radar_companies add column if not exists projects_page_url text;
alter table public.radar_companies add column if not exists monitor_active boolean not null default true;
alter table public.radar_companies add column if not exists monitor_priority smallint not null default 3;
alter table public.radar_companies add column if not exists last_research_at timestamptz;
alter table public.radar_companies add column if not exists next_research_at timestamptz;
alter table public.radar_companies add column if not exists research_status text;
alter table public.radar_companies add column if not exists research_note text;
alter table public.radar_companies add column if not exists opted_out boolean not null default false;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'radar_companies_private_check') then
    alter table public.radar_companies add constraint radar_companies_private_check check (
      (sector is null or sector in ('kamu', 'ozel', 'bilinmiyor'))
      and (size_band is null or size_band in ('kucuk', 'yerel', 'orta', 'buyuk', 'bilinmiyor'))
      and (contractor_kind is null or contractor_kind in ('muteahhit', 'gelistirici', 'kooperatif', 'kentsel_donusum', 'genel_yuklenici', 'alt_yuklenici', 'bilinmiyor'))
      and (name_basis is null or name_basis in ('metin', 'alan_adi', 'sahip'))
      and (discovery_source is null or discovery_source in ('kaynak', 'arama', 'firma_sitesi', 'sahip'))
      and (discovery_url is null or (discovery_url ~* '^https?://' and char_length(discovery_url) <= 2000))
      and (discovery_query is null or char_length(discovery_query) <= 400)
      and (projects_page_url is null or (projects_page_url ~ '^https://' and char_length(projects_page_url) <= 500))
      and monitor_priority between 1 and 5
      and cardinality(districts) <= 40 and cardinality(cities) <= 20
      and (research_status is null or research_status in ('ok', 'hata', 'robots_yasak', 'proje_sayfasi_yok', 'atlandi'))
      and (research_note is null or char_length(research_note) <= 500));
  end if;
end;
$$;
create index if not exists radar_companies_research_idx on public.radar_companies (next_research_at nulls first) where monitor_active and website is not null;
grant update (monitor_active, monitor_priority, opted_out, projects_page_url, sector, contractor_kind) on table public.radar_companies to authenticated;

-- =====================================================================
-- C) FIRSAT: Ã–ZEL SEKTÃ–R ALANLARI
-- =====================================================================
alter table public.radar_opportunities add column if not exists private_score smallint;
alter table public.radar_opportunities add column if not exists private_score_breakdown jsonb not null default '[]'::jsonb;
alter table public.radar_opportunities add column if not exists segments text[] not null default '{}';
alter table public.radar_opportunities add column if not exists stage_display text;
alter table public.radar_opportunities add column if not exists stage_confidence text;
alter table public.radar_opportunities add column if not exists stage_active boolean;
alter table public.radar_opportunities add column if not exists stage_new_start boolean not null default false;
alter table public.radar_opportunities add column if not exists stage_evidence_url text;
alter table public.radar_opportunities add column if not exists stage_evidence_at timestamptz;
alter table public.radar_opportunities add column if not exists stage_verified_at timestamptz;
alter table public.radar_opportunities add column if not exists stage_explanation text;
alter table public.radar_opportunities add column if not exists unit_count integer;
alter table public.radar_opportunities add column if not exists unit_text text;
alter table public.radar_opportunities add column if not exists size_band text;
alter table public.radar_opportunities add column if not exists page_kind text;
alter table public.radar_opportunities add column if not exists procurement_status text;
alter table public.radar_opportunities add column if not exists relevance_explanation text;
alter table public.radar_opportunities add column if not exists discovered_via text;
alter table public.radar_opportunities add column if not exists last_research_at timestamptz;
alter table public.radar_opportunities add column if not exists next_research_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'radar_opportunities_private_check') then
    alter table public.radar_opportunities add constraint radar_opportunities_private_check check (
      (private_score is null or private_score between 0 and 100)
      and jsonb_typeof(private_score_breakdown) = 'array'
      and segments <@ array['ozel_proje', 'yeni_baslayan', 'aktif_santiye', 'teklif_firsati', 'kamu_ihale']::text[]
      and (stage_display is null or char_length(stage_display) <= 200)
      and (stage_confidence is null or stage_confidence in ('yuksek', 'orta', 'dusuk'))
      and (stage_evidence_url is null or (stage_evidence_url ~* '^https?://' and char_length(stage_evidence_url) <= 2000))
      and (stage_explanation is null or char_length(stage_explanation) <= 500)
      and (unit_count is null or unit_count between 1 and 10000)
      and (unit_text is null or char_length(unit_text) <= 60)
      and (size_band is null or size_band in ('kucuk', 'yerel', 'orta', 'buyuk', 'bilinmiyor'))
      and (page_kind is null or page_kind in ('firma_sitesi', 'firma_proje_sayfasi', 'haber', 'ilan_portali', 'kamu', 'diger'))
      and (procurement_status is null or procurement_status in ('dogrulanmis_talep', 'tedarikci_daveti', 'potansiyel'))
      and (relevance_explanation is null or char_length(relevance_explanation) <= 800)
      and (discovered_via is null or discovered_via in ('kaynak', 'arama', 'firma_sitesi'))
      -- Yeni baÅŸlayan / aktif ÅŸantiye yalnÄ±z kanÄ±t tarihiyle (tahmin yok)
      and (not stage_new_start or stage_evidence_at is not null)
      and (stage_active is not true or stage_evidence_at is not null));
  end if;
end;
$$;
create index if not exists radar_opportunities_segments_idx on public.radar_opportunities using gin (segments);
create index if not exists radar_opportunities_private_idx on public.radar_opportunities (private_score desc nulls last);

-- =====================================================================
-- D) KEÅÄ°F KAYITLARI
-- =====================================================================
create table if not exists public.radar_discovery_queries (
  key          text primary key check (char_length(key) between 3 and 200),
  pattern      text not null check (char_length(pattern) between 1 and 60),
  family       text not null check (family in ('proje', 'firma', 'asama', 'tedarik', 'site')),
  city         text not null check (char_length(city) between 1 and 60),
  district     text check (district is null or char_length(district) <= 60),
  query        text not null check (char_length(query) between 3 and 400),
  runs         integer not null default 0 check (runs >= 0),
  results      integer not null default 0 check (results >= 0),
  new_results  integer not null default 0 check (new_results >= 0),
  last_status  text check (last_status is null or last_status in ('ok', 'hata', 'kota')),
  last_run_at  timestamptz,
  updated_at   timestamptz not null default now()
);

create table if not exists public.radar_discovery_seen (
  url_hash      text primary key check (url_hash ~ '^[0-9a-f]{64}$'),
  url           text not null check (char_length(url) <= 2000 and url ~* '^https?://'),
  domain        text check (domain is null or char_length(domain) <= 255),
  query_key     text check (query_key is null or char_length(query_key) <= 200),
  page_kind     text check (page_kind is null or page_kind in ('firma_sitesi', 'firma_proje_sayfasi', 'haber', 'ilan_portali', 'kamu', 'diger')),
  outcome       text not null check (outcome in ('firsat', 'ret', 'tekrar')),
  reject_reason text check (reject_reason is null or char_length(reject_reason) <= 40),
  times_seen    integer not null default 1 check (times_seen >= 1),
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);
create index if not exists radar_discovery_seen_recent_idx on public.radar_discovery_seen (last_seen_at desc);

create table if not exists public.radar_discovery_runs (
  id                  uuid primary key default gen_random_uuid(),
  started_at          timestamptz not null default now(),
  finished_at         timestamptz,
  status              text not null check (status in ('basarili', 'basarili_yeni_yok', 'eksik', 'basarisiz', 'kaynak_yok', 'yapilandirma_eksik', 'kota_doldu')),
  sources             jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array'),
  query_log           jsonb not null default '[]'::jsonb check (jsonb_typeof(query_log) = 'array'),
  districts           text[] not null default '{}',
  results_seen        integer not null default 0 check (results_seen >= 0),
  results_new         integer not null default 0 check (results_new >= 0),
  results_rejected    integer not null default 0 check (results_rejected >= 0),
  companies_found     integer not null default 0 check (companies_found >= 0),
  companies_new       integer not null default 0 check (companies_new >= 0),
  company_pages       integer not null default 0 check (company_pages >= 0),
  projects_new        integer not null default 0 check (projects_new >= 0),
  projects_updated    integer not null default 0 check (projects_updated >= 0),
  contacts_verified   integer not null default 0 check (contacts_verified >= 0),
  outreach_candidates integer not null default 0 check (outreach_candidates >= 0),
  errors              jsonb not null default '[]'::jsonb check (jsonb_typeof(errors) = 'array'),
  api_calls           integer not null default 0 check (api_calls >= 0),
  quota_used          integer,
  quota_limit         integer,
  quota_remaining     integer,
  diversity           jsonb,
  note                text check (note is null or char_length(note) <= 1000)
);
create index if not exists radar_discovery_runs_recent_idx on public.radar_discovery_runs (started_at desc);

-- =====================================================================
-- E) E-POSTA KUYRUÄU, GÃ–NDERÄ°M DEFTERÄ°, RET LÄ°STESÄ°
-- =====================================================================
alter table public.radar_outreach_drafts add column if not exists brands text[] not null default '{}';
alter table public.radar_outreach_drafts add column if not exists services text[] not null default '{}';
alter table public.radar_outreach_drafts add column if not exists eligibility jsonb;
alter table public.radar_outreach_drafts add column if not exists blocked_reasons text[] not null default '{}';
alter table public.radar_outreach_drafts add column if not exists generated_by text not null default 'sahip';
alter table public.radar_outreach_drafts add column if not exists reply_status text not null default 'yok';
alter table public.radar_outreach_drafts add column if not exists reply_at timestamptz;
alter table public.radar_outreach_drafts add column if not exists reply_note text;
do $$
declare v_def text;
begin
  -- Taslak durumu geniÅŸletilir: 'inceleme' (sistem taslaÄŸÄ±, sahip onayÄ± bekliyor). Mevcut deÄŸerler korunur.
  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'public.radar_outreach_drafts'::regclass and conname = 'radar_outreach_drafts_status_check';
  if v_def is not null and v_def not like '%inceleme%' then
    execute 'alter table public.radar_outreach_drafts drop constraint radar_outreach_drafts_status_check';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.radar_outreach_drafts'::regclass and conname = 'radar_outreach_drafts_status_check') then
    execute $c$alter table public.radar_outreach_drafts add constraint radar_outreach_drafts_status_check
      check (status in ('taslak', 'inceleme', 'onaylandi', 'gonderildi_elle'))$c$;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'radar_outreach_drafts_private_check') then
    alter table public.radar_outreach_drafts add constraint radar_outreach_drafts_private_check check (
      generated_by in ('sahip', 'sistem')
      and reply_status in ('yok', 'yanit', 'olumlu', 'olumsuz', 'teklif_talebi', 'toplanti', 'listeden_cikar')
      and (reply_note is null or char_length(reply_note) <= 1000)
      and cardinality(brands) <= 2 and cardinality(services) <= 20 and cardinality(blocked_reasons) <= 20);
  end if;
end;
$$;
create unique index if not exists radar_outreach_drafts_system_unique on public.radar_outreach_drafts (opportunity_id, company_id) where generated_by = 'sistem';

-- GerÃ§ek gÃ¶nderim defteri: yalnÄ±z sunucu (radar-outreach, service_role) yazar. GÃ¶sterilen baÅŸarÄ± Ã¶lÃ§Ã¼tleri
-- buradan ve sahibin girdiÄŸi yanÄ±t durumundan gelir; tahmin veya garanti yoktur.
create table if not exists public.radar_outreach_sends (
  id               uuid primary key default gen_random_uuid(),
  draft_id         uuid references public.radar_outreach_drafts (id) on delete set null,
  opportunity_id   uuid references public.radar_opportunities (id) on delete set null,
  company_id       uuid references public.radar_companies (id) on delete set null,
  recipient        text not null check (recipient ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(recipient) <= 320),
  sender           text not null default 'erlindoorkapi@gmail.com' check (sender = 'erlindoorkapi@gmail.com'),
  gmail_message_id text check (gmail_message_id is null or char_length(gmail_message_id) <= 200),
  status           text not null check (status in ('gonderildi', 'hata')),
  error            text check (error is null or char_length(error) <= 500),
  sent_at          timestamptz not null default now()
);
create index if not exists radar_outreach_sends_company_idx on public.radar_outreach_sends (company_id, sent_at desc);

create table if not exists public.radar_outreach_suppression (
  id         uuid primary key default gen_random_uuid(),
  value      text not null unique check (char_length(value) between 3 and 320 and value = lower(value)),
  kind       text not null check (kind in ('eposta', 'alan_adi')),
  reason     text check (reason is null or char_length(reason) <= 300),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint radar_outreach_suppression_kind_value check (
    (kind = 'eposta' and value ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') or (kind = 'alan_adi' and value ~ '^[a-z0-9.-]+\.[a-z]{2,}$'))
);

-- =====================================================================
-- RLS ve yetkiler (yalnÄ±z sahip okur; keÅŸif/gÃ¶nderim kayÄ±tlarÄ±nÄ± yalnÄ±z sunucu yazar)
-- =====================================================================
alter table public.radar_discovery_queries    enable row level security;
alter table public.radar_discovery_seen       enable row level security;
alter table public.radar_discovery_runs       enable row level security;
alter table public.radar_outreach_sends       enable row level security;
alter table public.radar_outreach_suppression enable row level security;
revoke all on table public.radar_discovery_queries, public.radar_discovery_seen, public.radar_discovery_runs,
  public.radar_outreach_sends, public.radar_outreach_suppression from anon, authenticated;
grant select on table public.radar_discovery_queries, public.radar_discovery_seen, public.radar_discovery_runs,
  public.radar_outreach_sends, public.radar_outreach_suppression to authenticated;
grant insert (value, kind, reason), delete on table public.radar_outreach_suppression to authenticated;
grant update (reply_status, reply_at, reply_note) on table public.radar_outreach_drafts to authenticated;
do $$
declare t text;
begin
  foreach t in array array['radar_discovery_queries', 'radar_discovery_seen', 'radar_discovery_runs', 'radar_outreach_sends', 'radar_outreach_suppression'] loop
    perform pg_temp.leonx_policy('public', t, 'owner_select', 'select', '(select public.is_owner())', null);
  end loop;
  perform pg_temp.leonx_policy('public', 'radar_outreach_suppression', 'owner_insert', 'insert', null, '(select public.is_owner())');
  perform pg_temp.leonx_policy('public', 'radar_outreach_suppression', 'owner_delete', 'delete', '(select public.is_owner())', null);
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['radar_discovery_runs', 'radar_outreach_sends', 'radar_outreach_suppression'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;

-- =====================================================================
-- F) Ä°ÅLEVLER
-- =====================================================================

-- Ã–zel sektÃ¶r puanÄ±nÄ±n iletiÅŸim ve Ã¶nceki temas etkenlerini GÃœNCEL kayÄ±tlarla yeniden hesaplar
-- (privateIntel.ts contactPart/historyPart ile aynÄ± tablo). DÃ¶kÃ¼m boÅŸsa (keÅŸif gÃ¶rmemiÅŸ kayÄ±t) dokunmaz.
create or replace function public.radar_private_finalize(p_opp uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_br      jsonb;
  v_contact numeric := 0;
  v_creason text := 'Kurumsal iletiÅŸim kanalÄ± yok';
  v_last    timestamptz;
  v_days    integer;
  v_hist    numeric := 1;
  v_hreason text := 'Daha Ã¶nce temas kurulmadÄ±';
  v_out     jsonb := '[]'::jsonb;
  v_x       jsonb;
begin
  select private_score_breakdown into v_br from public.radar_opportunities where id = p_opp;
  if v_br is null or jsonb_array_length(v_br) = 0 then return; end if;
  if exists (select 1 from public.radar_contacts c join public.radar_opportunity_companies oc on oc.company_id = c.company_id
              where oc.opportunity_id = p_opp and c.kind in ('satinalma_eposta', 'tedarikci_portali', 'teknik_ofis_eposta')) then
    v_contact := 1; v_creason := 'DoÄŸrulanmÄ±ÅŸ satÄ±n alma / tedarikÃ§i kanalÄ± var';
  elsif exists (select 1 from public.radar_contacts c join public.radar_opportunity_companies oc on oc.company_id = c.company_id
                 where oc.opportunity_id = p_opp) then
    v_contact := 0.7; v_creason := 'DoÄŸrulanmÄ±ÅŸ kurumsal genel e-posta/telefon var';
  elsif exists (select 1 from public.radar_companies rc join public.radar_opportunity_companies oc on oc.company_id = rc.id
                 where oc.opportunity_id = p_opp and rc.website is not null) then
    v_contact := 0.4; v_creason := 'Firma web sitesi biliniyor, iletiÅŸim kanalÄ± henÃ¼z doÄŸrulanmadÄ±';
  end if;
  select greatest(max(s.sent_at), max(rc.last_outreach_at)) into v_last
    from public.radar_opportunity_companies oc
    join public.radar_companies rc on rc.id = oc.company_id
    left join public.radar_outreach_sends s on s.company_id = rc.id and s.status = 'gonderildi'
   where oc.opportunity_id = p_opp;
  if v_last is not null then
    v_days := greatest(0, floor(extract(epoch from (now() - v_last)) / 86400)::integer);
    if v_days > 90 then v_hist := 0.6; else v_hist := 0; end if;
    v_hreason := format('Son temas %s gÃ¼n Ã¶nce%s', v_days, case when v_days <= 90 then ' (90 gÃ¼nden yakÄ±n)' else '' end);
  end if;
  for v_x in select * from jsonb_array_elements(v_br) loop
    if v_x ->> 'key' = 'iletisim' then
      v_x := v_x || jsonb_build_object('factor', v_contact, 'points', round((v_x ->> 'weight')::numeric * v_contact, 1), 'reason', v_creason);
    elsif v_x ->> 'key' = 'gecmis' then
      v_x := v_x || jsonb_build_object('factor', v_hist, 'points', round((v_x ->> 'weight')::numeric * v_hist, 1), 'reason', v_hreason);
    end if;
    v_out := v_out || jsonb_build_array(v_x);
  end loop;
  update public.radar_opportunities
     set private_score_breakdown = v_out,
         private_score = greatest(0, least(100, round((select sum((x ->> 'points')::numeric) from jsonb_array_elements(v_out) x))::integer))
   where id = p_opp and private_score_breakdown is distinct from v_out;
end;
$$;
revoke all on function public.radar_private_finalize(uuid) from public, anon, authenticated;

create or replace function public.tg_radar_private_finalize()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_opp     uuid;
begin
  if tg_table_name = 'radar_opportunity_companies' then
    perform public.radar_private_finalize(coalesce(new.opportunity_id, old.opportunity_id));
    return null;
  end if;
  v_company := case when tg_op = 'DELETE' then old.company_id else new.company_id end;
  for v_opp in select opportunity_id from public.radar_opportunity_companies where company_id = v_company loop
    perform public.radar_private_finalize(v_opp);
  end loop;
  return null;
end;
$$;
revoke all on function public.tg_radar_private_finalize() from public, anon, authenticated;
create or replace trigger radar_contacts_private_finalize
  after insert or delete on public.radar_contacts for each row execute function public.tg_radar_private_finalize();
create or replace trigger radar_sends_private_finalize
  after insert on public.radar_outreach_sends for each row execute function public.tg_radar_private_finalize();
create or replace trigger radar_opp_companies_private_finalize
  after insert on public.radar_opportunity_companies for each row execute function public.tg_radar_private_finalize();

-- Ret listesi: yanÄ±t "listeden Ã§Ä±kar" olarak iÅŸaretlenince alÄ±cÄ± alan adÄ± deÄŸil, gÃ¶nderilen ADRES eklenir
create or replace function public.tg_radar_reply_optout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_email text;
begin
  if new.reply_status = 'listeden_cikar' and old.reply_status is distinct from 'listeden_cikar' then
    select lower(c.value) into v_email from public.radar_contacts c where c.id = new.contact_id;
    if v_email is not null then
      insert into public.radar_outreach_suppression (value, kind, reason) values (v_email, 'eposta', 'YanÄ±t: listeden Ã§Ä±kma talebi')
      on conflict (value) do nothing;
    end if;
    if new.company_id is not null then update public.radar_companies set opted_out = true where id = new.company_id; end if;
  end if;
  return new;
end;
$$;
revoke all on function public.tg_radar_reply_optout() from public, anon, authenticated;
create or replace trigger radar_drafts_reply_optout
  after update of reply_status on public.radar_outreach_drafts for each row execute function public.tg_radar_reply_optout();

-- KeÅŸif sonucunu yazar: radar_ingest'ten SONRA Ã§aÄŸrÄ±lÄ±r (fÄ±rsat url_hash â†’ radar_items ile bulunur).
-- YalnÄ±z service_role. Firma dizini, kanÄ±tlÄ± aÅŸama, Ã¶zel sektÃ¶r puanÄ±, bÃ¶lÃ¼mler, sorgu/sonuÃ§ kayÄ±tlarÄ±,
-- firma sitesi araÅŸtÄ±rma durumu ve doÄŸrulanmÄ±ÅŸ iletiÅŸim kanallarÄ±.
create or replace function public.radar_service_discovery_save(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_x        jsonb;
  v_c        jsonb;
  v_opp      public.radar_opportunities;
  v_cid      uuid;
  v_new_co   integer := 0;
  v_found_co integer := 0;
  v_new_pr   integer := 0;
  v_upd_pr   integer := 0;
  v_contacts integer := 0;
  v_since    timestamptz := coalesce((p ->> 'run_started_at')::timestamptz, now() - interval '10 minutes');
  v_newer    boolean;
  v_ins      boolean;
  v_seen_cos uuid[] := '{}';
  v_n        integer;
begin
  if jsonb_typeof(coalesce(p -> 'items', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p -> 'items', '[]'::jsonb)) > 300 then
    raise exception 'Ã–ÄŸe listesi geÃ§ersiz (en Ã§ok 300)' using errcode = '22023';
  end if;

  for v_x in select * from jsonb_array_elements(coalesce(p -> 'items', '[]'::jsonb)) loop
    select o.* into v_opp from public.radar_items i join public.radar_opportunities o on o.id = i.opportunity_id
     where i.url_hash = v_x ->> 'url_hash';
    if not found then continue; end if;
    if v_opp.first_seen_at >= v_since then v_new_pr := v_new_pr + 1; else v_upd_pr := v_upd_pr + 1; end if;
    -- Daha yeni (veya ilk) aÅŸama kanÄ±tÄ± mÄ±?
    v_newer := v_opp.stage_evidence_at is null
      or (nullif(v_x ->> 'stage_evidence_at', '') is not null and (v_x ->> 'stage_evidence_at')::timestamptz >= v_opp.stage_evidence_at);
    update public.radar_opportunities o set
      sector = case when v_x ->> 'sector' in ('kamu', 'ozel') and (o.sector = 'bilinmiyor' or v_x ->> 'page_kind' in ('kamu', 'firma_sitesi', 'firma_proje_sayfasi')) then v_x ->> 'sector' else o.sector end,
      page_kind = coalesce(o.page_kind, nullif(v_x ->> 'page_kind', '')),
      discovered_via = coalesce(o.discovered_via, nullif(v_x ->> 'discovered_via', '')),
      unit_count = coalesce(greatest(o.unit_count, nullif(v_x ->> 'unit_count', '')::integer), o.unit_count),
      unit_text = case when nullif(v_x ->> 'unit_count', '')::integer > coalesce(o.unit_count, 0) then left(v_x ->> 'unit_text', 60) else o.unit_text end,
      size_band = case when nullif(v_x ->> 'unit_count', '')::integer > coalesce(o.unit_count, 0) then v_x ->> 'size_band' else coalesce(o.size_band, nullif(v_x ->> 'size_band', '')) end,
      stage_display = case when v_newer then left(v_x ->> 'stage_display', 200) else o.stage_display end,
      stage_confidence = case when v_newer then nullif(v_x ->> 'stage_confidence', '') else o.stage_confidence end,
      stage_active = case when v_newer then (v_x ->> 'stage_active')::boolean else o.stage_active end,
      stage_new_start = case when v_newer then coalesce((v_x ->> 'stage_new_start')::boolean, false) else o.stage_new_start end,
      stage_evidence_url = case when v_newer then left(v_x ->> 'stage_evidence_url', 2000) else o.stage_evidence_url end,
      stage_evidence_at = case when v_newer then nullif(v_x ->> 'stage_evidence_at', '')::timestamptz else o.stage_evidence_at end,
      stage_verified_at = now(),
      stage_explanation = case when v_newer then left(v_x ->> 'stage_explanation', 500) else o.stage_explanation end,
      procurement_status = case when o.procurement_status = 'dogrulanmis_talep' then o.procurement_status else coalesce(nullif(v_x ->> 'procurement_status', ''), o.procurement_status) end,
      relevance_explanation = left(coalesce(nullif(v_x ->> 'relevance_explanation', ''), o.relevance_explanation), 800),
      segments = array(select distinct s from unnest(case when v_newer then array(select jsonb_array_elements_text(coalesce(v_x -> 'segments', '[]'::jsonb)))
                       else o.segments || array(select jsonb_array_elements_text(coalesce(v_x -> 'segments', '[]'::jsonb))) end) s
                       where s in ('ozel_proje', 'yeni_baslayan', 'aktif_santiye', 'teklif_firsati', 'kamu_ihale')),
      private_score = case when o.private_score is null or (v_x ->> 'private_score')::integer >= o.private_score or v_newer then (v_x ->> 'private_score')::integer else o.private_score end,
      private_score_breakdown = case when o.private_score is null or (v_x ->> 'private_score')::integer >= o.private_score or v_newer then coalesce(v_x -> 'private_score_breakdown', '[]'::jsonb) else o.private_score_breakdown end,
      last_research_at = now(),
      next_research_at = now() + interval '7 days'
    where o.id = v_opp.id;

    -- Firma dizini
    v_c := v_x -> 'company';
    if jsonb_typeof(v_c) = 'object' and coalesce(btrim(v_c ->> 'normalized_name'), '') <> '' then
      insert into public.radar_companies (name, normalized_name, website, website_source, sector, size_band, contractor_kind, company_kind,
        districts, cities, name_basis, discovery_source, discovery_url, discovery_query, first_discovered_at, next_research_at)
      values (left(btrim(v_c ->> 'name'), 200), left(btrim(v_c ->> 'normalized_name'), 200),
        case when coalesce(v_c ->> 'website', '') ~ '^https://[^\s/]+$' then left(v_c ->> 'website', 300) end,
        case when coalesce(v_c ->> 'website', '') ~ '^https://[^\s/]+$' then 'kanit' end,
        nullif(v_c ->> 'sector', ''), nullif(v_c ->> 'size_band', ''), nullif(v_c ->> 'contractor_kind', ''), nullif(v_c ->> 'company_kind', ''),
        array_remove(array[nullif(v_c ->> 'district', '')], null), array_remove(array[nullif(v_c ->> 'city', '')], null),
        nullif(v_c ->> 'name_basis', ''), nullif(v_c ->> 'discovery_source', ''), left(v_c ->> 'discovery_url', 2000), left(v_c ->> 'discovery_query', 400),
        now(), now())
      on conflict (normalized_name) do nothing
      returning id into v_cid;
      v_ins := v_cid is not null;
      if v_ins then
        v_new_co := v_new_co + 1;
      else
        select id into v_cid from public.radar_companies where normalized_name = left(btrim(v_c ->> 'normalized_name'), 200);
        update public.radar_companies rc set
          website = coalesce(rc.website, case when coalesce(v_c ->> 'website', '') ~ '^https://[^\s/]+$' then left(v_c ->> 'website', 300) end),
          website_source = coalesce(rc.website_source, case when rc.website is null and coalesce(v_c ->> 'website', '') ~ '^https://[^\s/]+$' then 'kanit' end),
          sector = coalesce(rc.sector, nullif(v_c ->> 'sector', '')),
          size_band = case when rc.size_band is null or rc.size_band = 'bilinmiyor' then nullif(v_c ->> 'size_band', '') else rc.size_band end,
          contractor_kind = case when rc.contractor_kind is null or rc.contractor_kind = 'bilinmiyor' then nullif(v_c ->> 'contractor_kind', '') else rc.contractor_kind end,
          company_kind = coalesce(rc.company_kind, nullif(v_c ->> 'company_kind', '')),
          districts = case when nullif(v_c ->> 'district', '') is null or (v_c ->> 'district') = any (rc.districts) or cardinality(rc.districts) >= 40 then rc.districts else rc.districts || (v_c ->> 'district') end,
          cities = case when nullif(v_c ->> 'city', '') is null or (v_c ->> 'city') = any (rc.cities) or cardinality(rc.cities) >= 20 then rc.cities else rc.cities || (v_c ->> 'city') end,
          name_basis = coalesce(rc.name_basis, nullif(v_c ->> 'name_basis', '')),
          discovery_source = coalesce(rc.discovery_source, nullif(v_c ->> 'discovery_source', '')),
          discovery_url = coalesce(rc.discovery_url, left(v_c ->> 'discovery_url', 2000)),
          first_discovered_at = coalesce(rc.first_discovered_at, now())
        where rc.id = v_cid;
      end if;
      if not (v_cid = any (v_seen_cos)) then
        v_seen_cos := v_seen_cos || v_cid;
        v_found_co := v_found_co + 1;
      end if;
      insert into public.radar_opportunity_companies (opportunity_id, company_id, role, verified, evidence_item_id)
      values (v_opp.id, v_cid, case when v_x ->> 'page_kind' in ('firma_sitesi', 'firma_proje_sayfasi') then 'proje_sahibi' else 'bilinmiyor' end, false,
              (select id from public.radar_items where url_hash = v_x ->> 'url_hash'))
      on conflict (opportunity_id, company_id) do nothing;
    end if;
    perform public.radar_private_finalize(v_opp.id);
  end loop;

  -- Sorgu istatistikleri (rotasyon)
  for v_x in select * from jsonb_array_elements(coalesce(p -> 'queries', '[]'::jsonb)) loop
    if coalesce(v_x ->> 'key', '') = '' then continue; end if;
    insert into public.radar_discovery_queries as q (key, pattern, family, city, district, query, runs, results, new_results, last_status, last_run_at)
    values (left(v_x ->> 'key', 200), left(v_x ->> 'pattern', 60), v_x ->> 'family', left(v_x ->> 'city', 60), nullif(left(v_x ->> 'district', 60), ''),
            left(v_x ->> 'query', 400), 1, coalesce((v_x ->> 'results')::integer, 0), coalesce((v_x ->> 'new_results')::integer, 0), v_x ->> 'status', now())
    on conflict (key) do update set runs = q.runs + 1, results = q.results + excluded.results, new_results = q.new_results + excluded.new_results,
      last_status = excluded.last_status, last_run_at = now(), query = excluded.query, updated_at = now();
  end loop;

  -- GÃ¶rÃ¼len sonuÃ§lar (tekilleÅŸtirme + artÄ±mlÄ± keÅŸif + kaynak Ã§eÅŸitliliÄŸi)
  for v_x in select * from jsonb_array_elements(coalesce(p -> 'seen', '[]'::jsonb)) loop
    if coalesce(v_x ->> 'url_hash', '') !~ '^[0-9a-f]{64}$' or coalesce(v_x ->> 'url', '') !~* '^https?://' then continue; end if;
    insert into public.radar_discovery_seen as s (url_hash, url, domain, query_key, page_kind, outcome, reject_reason)
    values (v_x ->> 'url_hash', left(v_x ->> 'url', 2000), left(v_x ->> 'domain', 255), left(v_x ->> 'query_key', 200), nullif(v_x ->> 'page_kind', ''),
            coalesce(nullif(v_x ->> 'outcome', ''), 'ret'), left(v_x ->> 'reject_reason', 40))
    on conflict (url_hash) do update set times_seen = s.times_seen + 1, last_seen_at = now(),
      outcome = case when excluded.outcome = 'firsat' then 'firsat' else s.outcome end;
  end loop;

  -- Firma sitesi araÅŸtÄ±rma durumu (bir sonraki araÅŸtÄ±rma: Ã¶ncelik 1 â†’ 3 gÃ¼n â€¦ 5 â†’ 21 gÃ¼n)
  for v_x in select * from jsonb_array_elements(coalesce(p -> 'companies_checked', '[]'::jsonb)) loop
    update public.radar_companies set last_research_at = now(),
      next_research_at = now() + make_interval(days => case monitor_priority when 1 then 3 when 2 then 5 when 3 then 7 when 4 then 14 else 21 end),
      research_status = case when v_x ->> 'status' in ('ok', 'hata', 'robots_yasak', 'proje_sayfasi_yok', 'atlandi') then v_x ->> 'status' else 'hata' end,
      research_note = left(v_x ->> 'note', 500),
      projects_page_url = coalesce(projects_page_url, case when coalesce(v_x ->> 'projects_page_url', '') ~ '^https://' then left(v_x ->> 'projects_page_url', 500) end)
    where id = (v_x ->> 'id')::uuid;
  end loop;

  -- FirmanÄ±n KENDÄ° sitesinden doÄŸrulanmÄ±ÅŸ kurumsal iletiÅŸim kanallarÄ± (kaynak adresi + doÄŸrulama zamanÄ±)
  for v_x in select * from jsonb_array_elements(coalesce(p -> 'contacts', '[]'::jsonb)) loop
    begin
      insert into public.radar_contacts (company_id, kind, value, source_url, verified_at, created_by)
      values ((v_x ->> 'company_id')::uuid, v_x ->> 'kind', left(v_x ->> 'value', 500), left(v_x ->> 'source_url', 2000), (v_x ->> 'verified_at')::timestamptz, null)
      on conflict (company_id, kind, value) do update set verified_at = excluded.verified_at, source_url = excluded.source_url;
      get diagnostics v_n = row_count;
      v_contacts := v_contacts + v_n;
    exception when check_violation or foreign_key_violation or invalid_text_representation then
      null; -- geÃ§ersiz kanal atlanÄ±r
    end;
  end loop;

  return jsonb_build_object('companies_new', v_new_co, 'companies_found', v_found_co, 'projects_new', v_new_pr, 'projects_updated', v_upd_pr, 'contacts_verified', v_contacts);
end;
$$;
revoke all on function public.radar_service_discovery_save(jsonb) from public, anon, authenticated;

-- Arama kotasÄ± (LEONX bÃ¼tÃ§esi: aylÄ±k sÄ±nÄ±r âˆ’ kullanÄ±lan). SaÄŸlayÄ±cÄ±nÄ±n kendi kalan kotasÄ± ayrÄ±ca bilinmez.
create or replace function public.radar_search_quota()
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  select jsonb_build_object(
    'month_used', coalesce(u.calls, 0), 'month_limit', s.search_monthly_limit, 'month_remaining', greatest(0, s.search_monthly_limit - coalesce(u.calls, 0)),
    'day_used', case when u.day = (now() at time zone 'Europe/Istanbul')::date then u.day_calls else 0 end, 'day_limit', s.search_daily_limit)
  from public.radar_settings s
  left join public.radar_search_usage u on u.month = date_trunc('month', (now() at time zone 'Europe/Istanbul'))::date
  where s.singleton;
$$;

-- KeÅŸif yapÄ±landÄ±rmasÄ± (yalnÄ±z service_role)
create or replace function public.radar_service_discovery_config()
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  select jsonb_build_object(
    'source', (select to_jsonb(s) from public.radar_sources s where s.kind = 'search_api' and s.sector_hint = 'ozel' order by s.active desc, s.created_at limit 1),
    'settings', (select jsonb_build_object('discovery_enabled', discovery_enabled, 'search_api_enabled', search_api_enabled,
                   'queries_per_run', discovery_queries_per_run, 'company_monitoring_enabled', company_monitoring_enabled,
                   'company_pages_per_run', company_pages_per_run, 'outreach_min_score', outreach_min_score,
                   'excluded_companies', excluded_companies, 'outreach_auto_send', outreach_auto_send, 'gmail_verified_at', gmail_verified_at,
                   'outreach_legal_confirmed_at', outreach_legal_confirmed_at, 'outreach_daily_limit', outreach_daily_limit) from public.radar_settings where singleton),
    'run_index', (select count(*) from public.radar_discovery_runs),
    'quota', public.radar_search_quota());
$$;

-- Ä°zlenmesi zamanÄ± gelen firma siteleri
create or replace function public.radar_service_due_companies(p_limit integer)
returns setof public.radar_companies
language sql
security definer
set search_path = ''
stable
as $$
  select * from public.radar_companies
   where monitor_active and website is not null and not excluded and not opted_out
     and coalesce(sector, 'ozel') <> 'kamu'
     and (next_research_at is null or next_research_at <= now())
   order by monitor_priority, next_research_at nulls first, created_at
   limit greatest(0, least(coalesce(p_limit, 2), 10));
$$;

-- E-posta adayÄ±: Ã¶zel sektÃ¶r projesi + eÅŸik puanÄ± + firmanÄ±n kendi sitesinden doÄŸrulanmÄ±ÅŸ e-posta + taslaÄŸÄ± yok
create or replace function public.radar_service_outreach_candidates(p_limit integer)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select jsonb_build_object(
      'opportunity', jsonb_build_object('id', o.id, 'title', o.title, 'city', o.city, 'district', o.district, 'project_type', o.project_type,
        'construction_stage', o.construction_stage, 'stage_active', o.stage_active, 'stage_confidence', o.stage_confidence, 'verified_need', o.verified_need,
        'procurement_status', o.procurement_status, 'private_score', o.private_score, 'product_groups', o.product_groups, 'sector', o.sector,
        'stage_evidence_url', o.stage_evidence_url, 'unit_text', o.unit_text,
        'evidence_url', (select e.url from public.radar_evidence e where e.opportunity_id = o.id order by e.accessed_at limit 1)),
      'company', jsonb_build_object('id', rc.id, 'name', rc.name, 'name_basis', rc.name_basis, 'website', rc.website, 'excluded', rc.excluded, 'opted_out', rc.opted_out),
      'contact', jsonb_build_object('id', c.id, 'email', c.value, 'kind', c.kind, 'verified_at', c.verified_at, 'source_url', c.source_url),
      'last_email_days', (select floor(extract(epoch from (now() - max(s.sent_at))) / 86400)::integer from public.radar_outreach_sends s where s.company_id = rc.id and s.status = 'gonderildi'),
      'suppressed', exists (select 1 from public.radar_outreach_suppression su where su.value = lower(c.value) or su.value = lower(split_part(c.value, '@', 2)))
    ) as x
    from public.radar_opportunities o
    join public.radar_opportunity_companies oc on oc.opportunity_id = o.id
    join public.radar_companies rc on rc.id = oc.company_id
    join lateral (
      select * from public.radar_contacts c where c.company_id = rc.id and c.kind in ('satinalma_eposta', 'teknik_ofis_eposta', 'genel_eposta')
       order by case c.kind when 'satinalma_eposta' then 0 when 'teknik_ofis_eposta' then 1 else 2 end, c.verified_at desc limit 1
    ) c on true
    where 'ozel_proje' = any (o.segments) and o.status not in ('ilgisiz', 'kaybedildi', 'kazanildi')
      and coalesce(o.private_score, 0) >= (select outreach_min_score from public.radar_settings where singleton)
      and not rc.excluded and not rc.opted_out
      and not exists (select 1 from public.radar_outreach_drafts d where d.opportunity_id = o.id and d.company_id = rc.id)
    order by o.private_score desc nulls last
    limit greatest(0, least(coalesce(p_limit, 10), 50))
  ) t;
$$;

-- Sistem taslaklarÄ± inceleme kuyruÄŸuna yazÄ±lÄ±r (asla doÄŸrudan gÃ¶nderilmez)
create or replace function public.radar_service_save_drafts(p_drafts jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_x jsonb;
  v_n integer := 0;
  v_c integer;
begin
  if jsonb_typeof(p_drafts) <> 'array' or jsonb_array_length(p_drafts) > 50 then
    raise exception 'Taslak listesi geÃ§ersiz (en Ã§ok 50)' using errcode = '22023';
  end if;
  for v_x in select * from jsonb_array_elements(p_drafts) loop
    insert into public.radar_outreach_drafts (opportunity_id, company_id, contact_id, subject, body, status, brands, services, eligibility, blocked_reasons, generated_by, created_by)
    values ((v_x ->> 'opportunity_id')::uuid, (v_x ->> 'company_id')::uuid, (v_x ->> 'contact_id')::uuid, left(v_x ->> 'subject', 300), left(v_x ->> 'body', 10000),
            'inceleme', array(select jsonb_array_elements_text(coalesce(v_x -> 'brands', '[]'::jsonb))), array(select jsonb_array_elements_text(coalesce(v_x -> 'services', '[]'::jsonb))),
            v_x -> 'eligibility', array(select left(jsonb_array_elements_text(coalesce(v_x -> 'blocked_reasons', '[]'::jsonb)), 40)), 'sistem', null)
    on conflict do nothing;
    get diagnostics v_c = row_count;
    v_n := v_n + v_c;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.radar_service_save_drafts(jsonb) from public, anon, authenticated;

-- GÃ¶nderime hazÄ±r, sahibin ONAYLADIÄI sistem taslaklarÄ± (radar-outreach)
create or replace function public.radar_service_send_queue(p_limit integer)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  select jsonb_build_object(
    'settings', (select jsonb_build_object('auto_send', outreach_auto_send, 'gmail_verified_at', gmail_verified_at, 'legal_confirmed_at', outreach_legal_confirmed_at,
                   'daily_limit', outreach_daily_limit) from public.radar_settings where singleton),
    'sent_today', (select count(*) from public.radar_outreach_sends where status = 'gonderildi' and sent_at >= date_trunc('day', now() at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul'),
    'drafts', coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('id', d.id, 'subject', d.subject, 'body', d.body, 'opportunity_id', d.opportunity_id, 'company_id', d.company_id,
        'sector', o.sector, 'has_evidence', exists (select 1 from public.radar_evidence e where e.opportunity_id = o.id),
        'company', jsonb_build_object('website', rc.website, 'excluded', rc.excluded, 'opted_out', rc.opted_out),
        'contact', case when c.id is null then null else jsonb_build_object('email', c.value, 'kind', c.kind, 'verified_at', c.verified_at, 'source_url', c.source_url) end,
        'last_email_days', (select floor(extract(epoch from (now() - max(s.sent_at))) / 86400)::integer from public.radar_outreach_sends s where s.company_id = rc.id and s.status = 'gonderildi'),
        'suppressed', c.id is not null and exists (select 1 from public.radar_outreach_suppression su where su.value = lower(c.value) or su.value = lower(split_part(c.value, '@', 2)))) as x
      from public.radar_outreach_drafts d
      join public.radar_opportunities o on o.id = d.opportunity_id
      left join public.radar_companies rc on rc.id = d.company_id
      left join public.radar_contacts c on c.id = d.contact_id
      where d.status = 'onaylandi' and d.generated_by = 'sistem'
        and not exists (select 1 from public.radar_outreach_sends s where s.draft_id = d.id)
      order by d.updated_at limit greatest(0, least(coalesce(p_limit, 5), 20))) t), '[]'::jsonb));
$$;

create or replace function public.radar_service_record_send(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.radar_outreach_sends (draft_id, opportunity_id, company_id, recipient, gmail_message_id, status, error)
  values ((p ->> 'draft_id')::uuid, (p ->> 'opportunity_id')::uuid, (p ->> 'company_id')::uuid, lower(p ->> 'recipient'),
          left(p ->> 'gmail_message_id', 200), case when p ->> 'status' = 'gonderildi' then 'gonderildi' else 'hata' end, left(p ->> 'error', 500));
  if p ->> 'status' = 'gonderildi' and nullif(p ->> 'company_id', '') is not null then
    update public.radar_companies set last_outreach_at = now() where id = (p ->> 'company_id')::uuid;
  end if;
end;
$$;
revoke all on function public.radar_service_record_send(jsonb) from public, anon, authenticated;

-- Gmail baÄŸlantÄ± denetimi sonucu (yalnÄ±z sunucu). BaÅŸarÄ±sÄ±zsa otomatik gÃ¶nderim kapanÄ±r.
create or replace function public.radar_service_gmail_status(p_ok boolean, p_detail jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.radar_settings set
    gmail_last_check = jsonb_build_object('ok', p_ok, 'at', now(), 'email', left(p_detail ->> 'email', 320), 'error', left(p_detail ->> 'error', 300)),
    gmail_verified_at = case when p_ok then now() else null end,
    outreach_auto_send = case when p_ok then outreach_auto_send else false end
  where singleton;
end;
$$;
revoke all on function public.radar_service_gmail_status(boolean, jsonb) from public, anon, authenticated;

do $$
declare f text;
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    foreach f in array array['public.radar_service_discovery_save(jsonb)', 'public.radar_service_discovery_config()', 'public.radar_search_quota()',
      'public.radar_service_due_companies(integer)', 'public.radar_service_outreach_candidates(integer)', 'public.radar_service_save_drafts(jsonb)',
      'public.radar_service_send_queue(integer)', 'public.radar_service_record_send(jsonb)', 'public.radar_service_gmail_status(boolean, jsonb)',
      'public.radar_private_finalize(uuid)'] loop
      execute format('grant execute on function %s to service_role', f);
    end loop;
  end if;
end;
$$;
revoke all on function public.radar_service_discovery_config() from public, anon, authenticated;
revoke all on function public.radar_search_quota() from public, anon;
revoke all on function public.radar_service_due_companies(integer) from public, anon, authenticated;
revoke all on function public.radar_service_outreach_candidates(integer) from public, anon, authenticated;
revoke all on function public.radar_service_send_queue(integer) from public, anon, authenticated;
grant execute on function public.radar_search_quota() to authenticated;

-- KeÅŸif kaynaÄŸÄ± genel tarama dÃ¶ngÃ¼sÃ¼ne kiralanmaz (kendi saatlik keÅŸif zamanlayÄ±cÄ±sÄ± var)
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
       and not (kind = 'search_api' and sector_hint = 'ozel')
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

-- ---------------------------------------------------------------- Ä°lÃ§e kapsamÄ± ve panel Ã¶zeti (sahip)
create or replace function public.radar_district_coverage()
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if not public.is_owner() then raise exception 'Yetkisiz' using errcode = '42501'; end if;
  return coalesce((
    with d(city, district, ord) as (
      select 'Ankara', x, n from unnest(array['Ã‡ankaya', 'Yenimahalle', 'Etimesgut', 'Sincan', 'GÃ¶lbaÅŸÄ±', 'Pursaklar', 'KeÃ§iÃ¶ren', 'Mamak', 'AltÄ±ndaÄŸ',
        'Kahramankazan', 'Akyurt', 'PolatlÄ±', 'BeypazarÄ±', 'ElmadaÄŸ', 'Kalecik', 'Ã‡ubuk', 'Haymana', 'KÄ±zÄ±lcahamam', 'AyaÅŸ', 'Bala', 'Ã‡amlÄ±dere',
        'Evren', 'GÃ¼dÃ¼l', 'NallÄ±han', 'ÅereflikoÃ§hisar']) with ordinality as t(x, n)
      union all select 'Hatay', x, 100 + n from unnest(array['Antakya', 'Ä°skenderun', 'Defne', 'DÃ¶rtyol', 'KÄ±rÄ±khan']) with ordinality as t(x, n)
      union all select 'KahramanmaraÅŸ', x, 200 + n from unnest(array['OnikiÅŸubat', 'DulkadiroÄŸlu', 'Elbistan', 'PazarcÄ±k']) with ordinality as t(x, n)
    ), q as (
      select ql ->> 'city' as city, ql ->> 'district' as district, count(*) as n, sum(coalesce((ql ->> 'results')::integer, 0)) as results, max(r.started_at) as last_at
        from public.radar_discovery_runs r, jsonb_array_elements(r.query_log) ql
       where r.started_at >= now() - interval '30 days' and ql ->> 'status' = 'ok'
       group by 1, 2
    )
    select jsonb_agg(jsonb_build_object(
      'city', d.city, 'district', d.district,
      'queries30d', coalesce(q.n, 0), 'results30d', coalesce(q.results, 0), 'last_searched_at', q.last_at,
      'companies', (select count(*) from public.radar_companies rc where d.district = any (rc.districts) and coalesce(rc.sector, 'ozel') <> 'kamu'),
      'private_projects', (select count(*) from public.radar_opportunities o where o.district = d.district and 'ozel_proje' = any (o.segments) and o.status not in ('ilgisiz', 'kaybedildi')),
      'active_sites', (select count(*) from public.radar_opportunities o where o.district = d.district and 'ozel_proje' = any (o.segments) and o.stage_active is true and o.status not in ('ilgisiz', 'kaybedildi'))
    ) order by d.ord)
    from d left join q on q.city = d.city and q.district = d.district), '[]'::jsonb);
end;
$$;
revoke all on function public.radar_district_coverage() from public, anon;
grant execute on function public.radar_district_coverage() to authenticated;

create or replace function public.radar_private_overview()
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare v_live text[] := array['ilgisiz', 'kaybedildi'];
begin
  if not public.is_owner() then raise exception 'Yetkisiz' using errcode = '42501'; end if;
  return jsonb_build_object(
    'segments', jsonb_build_object(
      'ozel_proje', (select count(*) from public.radar_opportunities where 'ozel_proje' = any (segments) and status <> all (v_live)),
      'yeni_baslayan', (select count(*) from public.radar_opportunities where 'yeni_baslayan' = any (segments) and status <> all (v_live)),
      'aktif_santiye', (select count(*) from public.radar_opportunities where 'aktif_santiye' = any (segments) and status <> all (v_live)),
      'teklif_firsati', (select count(*) from public.radar_opportunities where 'teklif_firsati' = any (segments) and status <> all (v_live)),
      'kamu_ihale', (select count(*) from public.radar_opportunities where (sector = 'kamu' or 'kamu_ihale' = any (segments)) and status <> all (v_live)),
      'firmalar', (select count(*) from public.radar_companies where coalesce(sector, 'ozel') <> 'kamu' and not excluded)),
    'unverified_stage', (select count(*) from public.radar_opportunities where 'ozel_proje' = any (segments) and stage_active is not true and status <> all (v_live)),
    'quota', public.radar_search_quota(),
    'discovery_source', (select jsonb_build_object('id', id, 'name', name, 'permission_status', permission_status, 'active', active)
                           from public.radar_sources where kind = 'search_api' and sector_hint = 'ozel' order by active desc, created_at limit 1),
    'settings', (select jsonb_build_object('discovery_enabled', discovery_enabled, 'search_api_enabled', search_api_enabled, 'queries_per_run', discovery_queries_per_run,
                   'company_monitoring_enabled', company_monitoring_enabled, 'outreach_auto_send', outreach_auto_send, 'gmail_verified_at', gmail_verified_at,
                   'gmail_last_check', gmail_last_check, 'outreach_legal_confirmed_at', outreach_legal_confirmed_at) from public.radar_settings where singleton),
    'runs', coalesce((select jsonb_agg(to_jsonb(r) - 'query_log' || jsonb_build_object('queries', (select coalesce(jsonb_agg(ql ->> 'query'), '[]'::jsonb) from jsonb_array_elements(r.query_log) ql)) order by r.started_at desc)
                        from (select * from public.radar_discovery_runs order by started_at desc limit 20) r), '[]'::jsonb),
    -- SatÄ±ÅŸ performansÄ±: yalnÄ±z kayÄ±tlÄ± gerÃ§ek olaylar (durum geÃ§iÅŸleri, gÃ¶nderim defteri, sahibin iÅŸaretlediÄŸi yanÄ±tlar)
    'performance', jsonb_build_object(
      'emails_sent', (select count(*) from public.radar_outreach_sends where status = 'gonderildi'),
      'emails_failed', (select count(*) from public.radar_outreach_sends where status = 'hata'),
      'drafts_review', (select count(*) from public.radar_outreach_drafts where status = 'inceleme'),
      'drafts_manual_sent', (select count(*) from public.radar_outreach_drafts where status = 'gonderildi_elle'),
      'replies', (select count(*) from public.radar_outreach_drafts where reply_status <> 'yok'),
      'quote_requests', (select count(distinct opportunity_id) from public.radar_actions where to_status = 'teklif_istendi')
                        + (select count(*) from public.radar_outreach_drafts where reply_status = 'teklif_talebi'
                             and opportunity_id not in (select opportunity_id from public.radar_actions where to_status = 'teklif_istendi')),
      'meetings', (select count(distinct opportunity_id) from public.radar_actions where to_status = 'gorusme'),
      'quotes_sent', (select count(distinct opportunity_id) from public.radar_actions where to_status = 'teklif_verildi'),
      'won', (select count(distinct opportunity_id) from public.radar_actions where to_status = 'kazanildi'),
      'lost', (select count(distinct opportunity_id) from public.radar_actions where to_status = 'kaybedildi')));
end;
$$;
revoke all on function public.radar_private_overview() from public, anon;
grant execute on function public.radar_private_overview() to authenticated;

-- =====================================================================
-- G) KEÅÄ°F KAYNAÄI (baÅŸlangÄ±Ã§ta Ä°NCELENÄ°YOR + PASÄ°F) VE ZAMANLAYICI
-- =====================================================================
insert into public.radar_sources (name, kind, sector_hint, region_hint, permission_status, permission_note, interval_minutes, max_items, active)
select 'Ã–zel sektÃ¶r keÅŸfi â€” Arama API (Tavily)', 'search_api', 'ozel', 'Ankara (ikincil: Hatay, KahramanmaraÅŸ)', 'inceleniyor',
       'Yetkili arama API''si; Google sonuÃ§ sayfasÄ± kazÄ±nmaz. EtkinleÅŸtirmeden Ã¶nce: Tavily ticari kullanÄ±m koÅŸullarÄ± sahip tarafÄ±ndan onaylanmalÄ±, TAVILY_API_KEY Edge Function gizli deÄŸiÅŸkeni tanÄ±mlanmalÄ±, Ayarlar''da arama API ve keÅŸif aÃ§Ä±lmalÄ±.',
       60, 10, false
where not exists (select 1 from public.radar_sources where kind = 'search_api' and sector_hint = 'ozel');

alter table leonx_private.radar_config add column if not exists outreach_url text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'radar_config_outreach_url_check') then
    alter table leonx_private.radar_config add constraint radar_config_outreach_url_check check (outreach_url is null or outreach_url ~ '^https://');
  end if;
end;
$$;

create or replace function leonx_private.dispatch_radar_discover()
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
  select cron_secret into v_secret from leonx_private.push_config where singleton;
  if v_url is null or v_secret is null or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    return;
  end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 55000)'
    using v_url, '{"discover": true}'::jsonb, jsonb_build_object('Content-Type', 'application/json', 'x-leonx-cron', v_secret);
end;
$$;
revoke all on function leonx_private.dispatch_radar_discover() from public, anon, authenticated;

-- GÃ¶nderim iÅŸlevi (radar-outreach) ayrÄ± daÄŸÄ±tÄ±lÄ±r; adresi yapÄ±landÄ±rÄ±lmadÄ±kÃ§a istek yapÄ±lmaz.
-- Ä°ÅŸlev ayrÄ±ca kendi iÃ§inde Gmail doÄŸrulamasÄ± + ayar + uygunluk denetimi olmadan hiÃ§bir ÅŸey gÃ¶ndermez.
create or replace function leonx_private.dispatch_radar_outreach()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  select outreach_url into v_url from leonx_private.radar_config where singleton;
  select cron_secret into v_secret from leonx_private.push_config where singleton;
  if v_url is null or v_secret is null or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    return;
  end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 55000)'
    using v_url, '{"send": true}'::jsonb, jsonb_build_object('Content-Type', 'application/json', 'x-leonx-cron', v_secret);
end;
$$;
revoke all on function leonx_private.dispatch_radar_outreach() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net') then
    raise notice 'pg_cron / pg_net bulunamadÄ±; keÅŸif zamanlayÄ±cÄ±sÄ± kurulmadÄ±.';
    return;
  end if;
  execute 'create extension if not exists pg_cron';
  execute $q$select cron.schedule('leonx-radar-kesif', '47 * * * *', 'select leonx_private.dispatch_radar_discover()')$q$;
  execute $q$select cron.schedule('leonx-radar-eposta', '52 6-15 * * 1-5', 'select leonx_private.dispatch_radar_outreach()')$q$;  -- UTC: 09â€“18 TSÄ°, hafta iÃ§i
end;
$$;
