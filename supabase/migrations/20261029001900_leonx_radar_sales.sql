-- =====================================================================
-- LEONX OS — 019: AI Radar inşaat satış istihbaratı + bağımsız erişim izleme
--   A) Fırsat: satış sınıfı (A/B/C/D), ayrıntılı inşaat aşaması, satın alma TAHMİNİ, bölge önceliği,
--      ürün grupları, önerilen işlem, hariç tutulan firma. Değerler radar-scan'in öğe sınıflandırmasından
--      (radar_items.classification -> 'intel') sunucuda türetilir; istemci yazamaz.
--   B) Yüklenici dizini: firma türü, tedarikçi başvuru/satın alma adresi (yalnız https, kaynağıyla),
--      hariç tutma, son temas, sonraki işlem. Hariç tutulan firmalar (ayar: excluded_companies,
--      başlangıçta "Özçelik İnşaat") önerilmez.
--   C) Bildirim: yalnız anlamlı kayıtlar (A, B veya eski kayıtlarda doğrulanmış ihtiyaç); aşama ve
--      sınıf değişimleri tek bildirimde; hariç tutulan firmalar için bildirim yok.
--   D) Satış paneli özeti: radar_sales_overview() — sayılar doğrudan veritabanından.
--   E) Bağımsız erişim izleme: sürüm izleme (pg_cron, 10 dk) her yanıtı kaydeder; 3 ardışık hata →
--      sistem bildirimi. Sunucu tarafında çalışır; kullanıcı cihazlarına ve GitHub zamanlayıcısına bağlı değildir.
-- 015–018'e bağlıdır. Tekrar çalıştırılabilir; tablo veya veri silmez.
-- =====================================================================

-- =====================================================================
-- A) FIRSAT ALANLARI
-- =====================================================================
alter table public.radar_opportunities add column if not exists sales_class text;
alter table public.radar_opportunities add column if not exists construction_stage text;
alter table public.radar_opportunities add column if not exists stage_terms text[] not null default '{}';
alter table public.radar_opportunities add column if not exists procurement_outlook jsonb;
alter table public.radar_opportunities add column if not exists region_priority smallint;
alter table public.radar_opportunities add column if not exists product_groups text[] not null default '{}';
alter table public.radar_opportunities add column if not exists recommended_action text;
alter table public.radar_opportunities add column if not exists excluded_company text;
alter table public.radar_opportunities add column if not exists intel_updated_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'radar_opportunities_sales_class_check') then
    alter table public.radar_opportunities add constraint radar_opportunities_sales_class_check check (sales_class is null or sales_class in ('A', 'B', 'C', 'D'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'radar_opportunities_construction_stage_check') then
    alter table public.radar_opportunities add constraint radar_opportunities_construction_stage_check check (construction_stage is null or construction_stage in
      ('ruhsat', 'temel_atma', 'hafriyat', 'temel', 'kaba_insaat', 'kaba_tamam', 'duvar', 'cephe', 'dograma', 'ince_isler', 'tamamlandi'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'radar_opportunities_region_priority_check') then
    alter table public.radar_opportunities add constraint radar_opportunities_region_priority_check check (region_priority is null or region_priority between 1 and 5);
  end if;
end;
$$;
create index if not exists radar_opportunities_sales_idx on public.radar_opportunities (sales_class, region_priority, last_updated_at desc);

-- =====================================================================
-- B) YÜKLENİCİ DİZİNİ VE HARİÇ TUTMA
-- =====================================================================
alter table public.radar_companies add column if not exists company_kind text;
alter table public.radar_companies add column if not exists supplier_portal_url text;
alter table public.radar_companies add column if not exists supplier_portal_source text;
alter table public.radar_companies add column if not exists procurement_url text;
alter table public.radar_companies add column if not exists excluded boolean not null default false;
alter table public.radar_companies add column if not exists exclusion_reason text;
alter table public.radar_companies add column if not exists last_outreach_at timestamptz;
alter table public.radar_companies add column if not exists next_action text;
alter table public.radar_companies add column if not exists next_action_at date;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'radar_companies_kind_check') then
    alter table public.radar_companies add constraint radar_companies_kind_check check (company_kind is null or company_kind in ('yuklenici', 'gelistirici', 'yatirimci', 'kamu', 'mimar', 'diger'));
  end if;
  -- Adresler uydurulamaz: yalnız https ve (tedarikçi başvurusu için) kaynağı belirtilmiş olmalı
  if not exists (select 1 from pg_constraint where conname = 'radar_companies_urls_check') then
    alter table public.radar_companies add constraint radar_companies_urls_check check (
      (supplier_portal_url is null or (supplier_portal_url ~ '^https://' and char_length(supplier_portal_url) <= 500 and coalesce(btrim(supplier_portal_source), '') <> ''))
      and (procurement_url is null or (procurement_url ~ '^https://' and char_length(procurement_url) <= 500))
      and (next_action is null or char_length(next_action) <= 500)
      and (exclusion_reason is null or char_length(exclusion_reason) <= 300));
  end if;
end;
$$;
grant update (company_kind, supplier_portal_url, supplier_portal_source, procurement_url, excluded, exclusion_reason, last_outreach_at, next_action, next_action_at)
  on table public.radar_companies to authenticated;

alter table public.radar_settings add column if not exists excluded_companies text[] not null default '{}';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'radar_settings_excluded_companies_check') then
    alter table public.radar_settings add constraint radar_settings_excluded_companies_check check (cardinality(excluded_companies) <= 50);
  end if;
end;
$$;
grant update (excluded_companies) on table public.radar_settings to authenticated;
-- Sahibin isteği: Özçelik İnşaat önerilmez (listeden yalnız sahip çıkarabilir; burada yalnız eklenir)
update public.radar_settings set excluded_companies = excluded_companies || array['Özçelik İnşaat']
 where singleton and not ('Özçelik İnşaat' = any (excluded_companies));

/** Katlanmış (Türkçe harfsiz, küçük, tek boşluk) ad: hariç tutma eşleşmesi için */
create or replace function public.radar_fold_name(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(lower(translate(coalesce(p, ''), 'ÇĞİIÖŞÜÂÎÛçğıöşüâîû', 'CGIIOSUAIUcgiosuaiu')), '[^a-z0-9]+', ' ', 'g'));
$$;

-- =====================================================================
-- A2) ÖĞELERDEN FIRSAT İSTİHBARATI
--   sınıf: öğelerin en iyisi (A < B < C < D); hariç tutulan firma bağlıysa D.
--   aşama/tahmin: en güncel aşama bilgili öğeden (haber sırası); bölge: en yüksek öncelik.
-- =====================================================================
create or replace function public.radar_refresh_intel(p_opp uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class   text;
  v_stage   text;
  v_terms   text[];
  v_outlook jsonb;
  v_region  smallint;
  v_groups  text[];
  v_action  text;
  v_excl    text;
  v_any     boolean;
begin
  if p_opp is null then return; end if;
  select bool_or(i.classification ? 'intel') into v_any from public.radar_items i where i.opportunity_id = p_opp;
  if not coalesce(v_any, false) then return; end if;

  select min(i.classification -> 'intel' ->> 'salesClass') into v_class
    from public.radar_items i where i.opportunity_id = p_opp and i.classification -> 'intel' ->> 'salesClass' in ('A', 'B', 'C', 'D');
  select i.classification -> 'intel' ->> 'action' into v_action
    from public.radar_items i where i.opportunity_id = p_opp and i.classification -> 'intel' ->> 'salesClass' = v_class
   order by coalesce(i.published_at, i.first_seen_at) desc limit 1;
  select i.classification -> 'intel' ->> 'stage',
         array(select left(x, 60) from jsonb_array_elements_text(coalesce(i.classification -> 'intel' -> 'stageTerms', '[]'::jsonb)) x limit 10),
         i.classification -> 'intel' -> 'outlook'
    into v_stage, v_terms, v_outlook
    from public.radar_items i
   where i.opportunity_id = p_opp and coalesce(i.classification -> 'intel' ->> 'stage', '') <> ''
   order by coalesce(i.published_at, i.first_seen_at) desc limit 1;
  select min((i.classification -> 'intel' ->> 'regionPriority')::smallint) into v_region
    from public.radar_items i where i.opportunity_id = p_opp and (i.classification -> 'intel' ->> 'regionPriority') ~ '^[1-5]$';
  select array(select distinct g from public.radar_items i, jsonb_array_elements(coalesce(i.classification -> 'intel' -> 'products', '[]'::jsonb)) p,
                 lateral (select p ->> 'group' as g) x where i.opportunity_id = p_opp and g is not null order by g) into v_groups;
  select i.classification -> 'intel' ->> 'excluded' into v_excl
    from public.radar_items i where i.opportunity_id = p_opp and coalesce(i.classification -> 'intel' ->> 'excluded', '') <> '' limit 1;
  -- Bağlı firma hariç tutulmuşsa (dizin veya ayar listesi)
  if v_excl is null then
    select c.name into v_excl
      from public.radar_opportunity_companies oc join public.radar_companies c on c.id = oc.company_id
      left join public.radar_settings s on s.singleton
     where oc.opportunity_id = p_opp
       and (c.excluded or exists (select 1 from unnest(coalesce(s.excluded_companies, '{}')) e
                                  where public.radar_fold_name(e) <> '' and (' ' || public.radar_fold_name(c.name) || ' ') like ('% ' || public.radar_fold_name(e) || ' %')))
     limit 1;
  end if;
  if v_excl is not null then
    v_class := 'D';
    v_action := 'İşlem gerekmiyor (hariç tutulan firma)';
  end if;

  update public.radar_opportunities o set
    sales_class = v_class,
    construction_stage = case when v_stage in ('ruhsat', 'temel_atma', 'hafriyat', 'temel', 'kaba_insaat', 'kaba_tamam', 'duvar', 'cephe', 'dograma', 'ince_isler', 'tamamlandi') then v_stage else o.construction_stage end,
    stage_terms = case when v_stage is not null then coalesce(v_terms, '{}') else o.stage_terms end,
    procurement_outlook = case when v_class = 'D' then null when v_stage is not null then v_outlook else o.procurement_outlook end,
    region_priority = v_region,
    product_groups = coalesce(v_groups, '{}'),
    recommended_action = left(v_action, 300),
    excluded_company = left(v_excl, 200),
    intel_updated_at = now()
  where o.id = p_opp
    and (o.sales_class, o.construction_stage, o.region_priority, o.product_groups, o.recommended_action, o.excluded_company)
        is distinct from (v_class, coalesce(v_stage, o.construction_stage), v_region, coalesce(v_groups, '{}'), left(v_action, 300), left(v_excl, 200));
end;
$$;
revoke all on function public.radar_refresh_intel(uuid) from public, anon, authenticated;
revoke all on function public.radar_fold_name(text) from anon;

create or replace function public.tg_radar_item_intel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.opportunity_id is not null then
    perform public.radar_refresh_intel(new.opportunity_id);
  end if;
  if tg_op = 'UPDATE' and old.opportunity_id is not null and old.opportunity_id is distinct from new.opportunity_id then
    perform public.radar_refresh_intel(old.opportunity_id);
  end if;
  return null;
end;
$$;
revoke all on function public.tg_radar_item_intel() from public, anon, authenticated;
create or replace trigger radar_item_intel
  after insert or update of classification, opportunity_id on public.radar_items
  for each row execute function public.tg_radar_item_intel();

-- Firma bağlantısı öğeden sonra yazılır (radar_ingest): hariç tutma kontrolü için yeniden hesaplanır
create or replace function public.tg_radar_company_link_intel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.radar_refresh_intel(new.opportunity_id);
  return null;
end;
$$;
revoke all on function public.tg_radar_company_link_intel() from public, anon, authenticated;
create or replace trigger radar_company_link_intel
  after insert on public.radar_opportunity_companies
  for each row execute function public.tg_radar_company_link_intel();

-- Dizinde firma hariç tutulunca bağlı fırsatlar yeniden hesaplanır
create or replace function public.tg_radar_company_excluded()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v uuid;
begin
  for v in select opportunity_id from public.radar_opportunity_companies where company_id = new.id loop
    perform public.radar_refresh_intel(v);
  end loop;
  return null;
end;
$$;
revoke all on function public.tg_radar_company_excluded() from public, anon, authenticated;
create or replace trigger radar_company_excluded
  after update of excluded on public.radar_companies
  for each row when (new.excluded is distinct from old.excluded) execute function public.tg_radar_company_excluded();

-- Sınıflandırmayı yeniden yapan servis (radar-scan "reclassify": günlük yeniden değerlendirme).
-- Yalnız classification -> 'intel' yazılır; ham içerik ve kanıtlar değişmez.
create or replace function public.radar_service_set_intel(p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_x jsonb;
  v_n integer := 0;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 500 then
    raise exception 'Öğe listesi geçersiz (en çok 500)' using errcode = '22023';
  end if;
  for v_x in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_x -> 'intel') <> 'object' or coalesce(v_x -> 'intel' ->> 'salesClass', '') not in ('A', 'B', 'C', 'D') then continue; end if;
    update public.radar_items set classification = jsonb_set(coalesce(classification, '{}'::jsonb), '{intel}', v_x -> 'intel')
     where id = (v_x ->> 'id')::uuid and classification -> 'intel' is distinct from v_x -> 'intel';
    if found then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.radar_service_set_intel(jsonb) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.radar_service_set_intel(jsonb) to service_role;
  end if;
end;
$$;

-- Değişim kaydı yeni alanları kabul eder (yalnız kısıt genişletilir; veri değişmez)
do $$
declare v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint where conrelid = 'public.radar_changes'::regclass and conname = 'radar_changes_field_check';
  if v_def is not null and v_def not like '%insaat_asamasi%' then
    execute 'alter table public.radar_changes drop constraint radar_changes_field_check';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.radar_changes'::regclass and conname = 'radar_changes_field_check') then
    execute $c$alter table public.radar_changes add constraint radar_changes_field_check
      check (field in ('stage', 'deadline', 'verified_need', 'label', 'insaat_asamasi', 'satis_sinifi'))$c$;
  end if;
end;
$$;

-- Aşama / sınıf değişimi kaydı (yalnız daha önce bildirilmiş fırsatlar için; 016 ile aynı kural)
create or replace function public.tg_radar_sales_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.notified_at is null then
    return null;
  end if;
  if new.construction_stage is distinct from old.construction_stage and new.construction_stage is not null then
    insert into public.radar_changes (opportunity_id, field, old_value, new_value) values (new.id, 'insaat_asamasi', old.construction_stage, new.construction_stage);
  end if;
  if new.sales_class is distinct from old.sales_class and new.sales_class is not null then
    insert into public.radar_changes (opportunity_id, field, old_value, new_value) values (new.id, 'satis_sinifi', old.sales_class, new.sales_class);
  end if;
  return null;
end;
$$;
revoke all on function public.tg_radar_sales_changes() from public, anon, authenticated;
create or replace trigger radar_sales_change_log
  after update of construction_stage, sales_class on public.radar_opportunities
  for each row execute function public.tg_radar_sales_changes();

-- =====================================================================
-- C) BİLDİRİMLER: yalnız anlamlı kayıtlar
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
       and o.excluded_company is null
       -- 019: A (doğrulanmış talep) ve B (aktif proje) bildirilir; C/D yalnız panelde. Sınıfı olmayan eski kayıt: doğrulanmış ihtiyaçsa
       and (o.sales_class in ('A', 'B') or (o.sales_class is null and o.verified_need))
       and (o.sales_class = 'A' or o.score >= s.min_score)
       and o.first_seen_at > now() - interval '14 days'
       and (cardinality(s.notify_cities) = 0 or o.city = any (s.notify_cities) or o.district = any (s.notify_cities))
       and (cardinality(s.notify_categories) = 0 or exists (
             select 1 from public.radar_opportunity_categories c where c.opportunity_id = o.id and c.category_key = any (s.notify_categories)))
     order by o.sales_class nulls last, o.region_priority nulls last, o.score desc
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
    elsif r.sales_class = 'A' or (r.sales_class is null and r.verified_need) then
      perform public.leonx_notify('firsat', 'radar_dogrulanmis', 'Doğrulanmış talep: ' || r.title, v_body,
        '/leonx-ai/firsat/' || r.id, 'radar_opportunity', r.id, 'radar:' || r.id, true);
    else
      perform public.leonx_notify('firsat', 'radar_proje', 'Aktif inşaat projesi (açık talep doğrulanmadı): ' || r.title, v_body,
        '/leonx-ai/firsat/' || r.id, 'radar_opportunity', r.id, 'radar:' || r.id, true);
    end if;
    update public.radar_opportunities set notified_at = now() where id = r.id;
    v_n := v_n + 1;
  end loop;
  if v_dig > 0 then
    perform public.leonx_notify('firsat', 'radar_ozet', 'LEONX Radar günlük özeti: ' || v_dig || ' yeni kayıt',
      'Ayrıntılar LEONX AI panelinde', '/leonx-ai', null, null, 'radar:ozet:' || v_today, true);
  end if;
  return v_n;
end;
$$;
revoke all on function public.radar_notify_pending() from public, anon, authenticated;

create or replace function public.radar_notify_updates()
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
  v_days  integer;
  v_text  text;
  v_n     integer := 0;
begin
  select * into s from public.radar_settings where singleton;
  if not found then return 0; end if;
  v_quiet := s.quiet_start is not null and s.quiet_end is not null and s.quiet_start <> s.quiet_end and (
    case when s.quiet_start < s.quiet_end then v_hour >= s.quiet_start and v_hour < s.quiet_end
         else v_hour >= s.quiet_start or v_hour < s.quiet_end end);

  if v_hour >= 8 and (not v_quiet or s.critical_enabled) then
    for r in
      select o.id, o.title, o.city, o.deadline, o.score from public.radar_opportunities o
       where o.deadline is not null and o.deadline - v_today in (7, 3, 1, 0)
         and o.status not in ('ilgisiz', 'kaybedildi', 'kazanildi', 'teklif_verildi')
         and o.excluded_company is null
         and (o.verified_need or o.status <> 'yeni')
    loop
      v_days := r.deadline - v_today;
      perform public.leonx_notify('firsat', 'radar_son_tarih',
        case when v_days = 0 then 'Son teklif günü bugün: ' else 'Son tarihe ' || v_days || ' gün: ' end || r.title,
        coalesce(r.city || ' · ', '') || 'Puan ' || r.score || ' · son tarih ' || to_char(r.deadline, 'DD.MM.YYYY'),
        '/leonx-ai/firsat/' || r.id, 'radar_opportunity', r.id, 'radar:son:' || r.id || ':' || v_days, true);
      v_n := v_n + 1;
    end loop;
  end if;

  if v_quiet then
    return v_n;
  end if;

  for r in
    select c.opportunity_id, o.title, o.score, o.status, o.sales_class, o.verified_need, o.excluded_company,
           string_agg(case c.field
             when 'stage' then 'aşama ' || coalesce(c.old_value, '—') || ' → ' || coalesce(c.new_value, '—')
             when 'insaat_asamasi' then 'inşaat aşaması ' || coalesce(c.old_value, '—') || ' → ' || coalesce(c.new_value, '—')
             when 'satis_sinifi' then 'satış sınıfı ' || coalesce(c.old_value, '—') || ' → ' || coalesce(c.new_value, '—')
             when 'deadline' then 'son tarih ' || coalesce(c.old_value, '—') || ' → ' || coalesce(c.new_value, '—')
             when 'verified_need' then 'ihtiyaç kaynakla doğrulandı'
             else 'etiket ' || coalesce(c.old_value, '—') || ' → ' || coalesce(c.new_value, '—') end, ' · ' order by c.created_at) as summary,
           max(c.created_at) as last_at
      from public.radar_changes c join public.radar_opportunities o on o.id = c.opportunity_id
     where c.notified_at is null
     group by c.opportunity_id, o.title, o.score, o.status, o.sales_class, o.verified_need, o.excluded_company
     limit 50
  loop
    if r.excluded_company is null and r.status not in ('ilgisiz', 'kaybedildi', 'kazanildi')
       and (r.sales_class in ('A', 'B') or (r.sales_class is null and r.score >= s.min_score)) then
      v_text := left(r.summary, 400);
      perform public.leonx_notify('firsat', 'radar_degisiklik', 'Kayıt güncellendi: ' || r.title, v_text,
        '/leonx-ai/firsat/' || r.opportunity_id, 'radar_opportunity', r.opportunity_id,
        'radar:degisim:' || r.opportunity_id || ':' || to_char(r.last_at at time zone 'UTC', 'YYYYMMDDHH24MISS'), true);
      v_n := v_n + 1;
    end if;
    update public.radar_changes set notified_at = now() where opportunity_id = r.opportunity_id and notified_at is null and created_at <= r.last_at;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.radar_notify_updates() from public, anon, authenticated;

-- =====================================================================
-- D) SATIŞ PANELİ ÖZETİ
-- =====================================================================
create or replace function public.radar_sales_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today timestamptz := date_trunc('day', now() at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul';
begin
  if not public.is_owner() then raise exception 'Yetkisiz' using errcode = '42501'; end if;
  return jsonb_build_object(
    'checked_at', now(),
    'by_class', (select coalesce(jsonb_object_agg(coalesce(sales_class, '-'), n), '{}'::jsonb) from (
       select sales_class, count(*) n from public.radar_opportunities where status not in ('ilgisiz', 'kaybedildi') group by 1) t),
    'new_today', (select count(*) from public.radar_opportunities where first_seen_at >= v_today and coalesce(sales_class, 'C') <> 'D'),
    'updated_today', (select count(*) from public.radar_opportunities where last_updated_at >= v_today and first_seen_at < v_today and coalesce(sales_class, 'C') <> 'D'),
    'approaching', (select count(*) from public.radar_opportunities
       where sales_class = 'B' and procurement_outlook ->> 'pencere' in ('simdi', '0-3_ay') and status not in ('ilgisiz', 'kaybedildi', 'kazanildi')),
    'by_province', (select coalesce(jsonb_agg(to_jsonb(t) order by t.priority nulls last, t.n desc), '[]'::jsonb) from (
       select city, min(region_priority) as priority, count(*) n,
              count(*) filter (where sales_class = 'A') as a, count(*) filter (where sales_class = 'B') as b, count(*) filter (where sales_class = 'C') as c,
              (select coalesce(jsonb_agg(jsonb_build_object('district', d.district, 'n', d.n)), '[]'::jsonb) from (
                 select o2.district, count(*) n from public.radar_opportunities o2
                  where o2.city = o.city and o2.district is not null and coalesce(o2.sales_class, 'C') <> 'D' group by 1 order by 2 desc limit 10) d) as districts
         from public.radar_opportunities o
        where city is not null and coalesce(sales_class, 'C') <> 'D' and status not in ('ilgisiz', 'kaybedildi')
        group by city limit 30) t),
    'contractors_to_contact', (select coalesce(jsonb_agg(to_jsonb(t) order by t.best, t.priority nulls last), '[]'::jsonb) from (
       select c.id, c.name, c.company_kind, c.website, c.supplier_portal_url, c.next_action, c.next_action_at, c.last_outreach_at,
              min(o.sales_class) as best, min(o.region_priority) as priority, count(distinct o.id) as projects
         from public.radar_companies c
         join public.radar_opportunity_companies oc on oc.company_id = c.id
         join public.radar_opportunities o on o.id = oc.opportunity_id
        where not c.excluded and o.excluded_company is null and o.sales_class in ('A', 'B')
          and o.status not in ('ilgisiz', 'kaybedildi', 'kazanildi')
          and (c.last_outreach_at is null or c.last_outreach_at < now() - interval '14 days')
        group by c.id limit 20) t),
    'excluded_companies', (select excluded_companies from public.radar_settings where singleton)
  );
end;
$$;
revoke all on function public.radar_sales_overview() from public, anon;
grant execute on function public.radar_sales_overview() to authenticated;

-- =====================================================================
-- E) BAĞIMSIZ ERİŞİM İZLEME (sürüm izleme yanıtları)
-- =====================================================================
create schema if not exists leonx_private;
create table if not exists leonx_private.uptime_checks (
  id          bigint generated always as identity primary key,
  checked_at  timestamptz not null default now(),
  url         text not null,
  ok          boolean not null,
  status_code integer,
  error       text,
  build_id    text
);
create index if not exists uptime_checks_at_idx on leonx_private.uptime_checks (checked_at desc);
revoke all on table leonx_private.uptime_checks from public, anon, authenticated;

create or replace function leonx_private.check_release()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  w        leonx_private.release_watch;
  v_status integer;
  v_body   text;
  v_err    text;
  v_tout   boolean;
  v_row    jsonb;
  v_json   jsonb;
  v_id     bigint;
  v_fails  integer;
begin
  select * into w from leonx_private.release_watch where singleton for update;
  if not found or w.version_url is null then
    return;
  end if;
  if w.pending_id is not null and to_regclass('net._http_response') is not null then
    -- Satır JSON olarak okunur: pg_net sürümleri arasında sütun farkı (error_msg, timed_out) sorun olmaz
    execute 'select to_jsonb(r) from net._http_response r where r.id = $1' into v_row using w.pending_id;
    v_status := (v_row ->> 'status_code')::integer;
    v_body := v_row ->> 'content';
    v_err := v_row ->> 'error_msg';
    v_tout := coalesce((v_row ->> 'timed_out')::boolean, false);
    if v_status = 200 then
      begin
        v_json := v_body::jsonb;
      exception when others then
        v_json := null;
      end;
      if v_json is not null and v_json ->> 'env' = 'production' and coalesce(v_json ->> 'buildId', '') <> ''
         and v_json ->> 'buildId' is distinct from w.last_build_id then
        if w.last_build_id is not null then
          perform public.leonx_notify('sistem', 'surum_yeni', 'Yeni LEONX OS sürümü hazır',
            left('Sürüm ' || coalesce(v_json ->> 'version', '?') || ' · ' || coalesce(v_json ->> 'commit', '?'), 500),
            '/ayarlar', null, null, 'surum_yeni:' || left(v_json ->> 'buildId', 150), true);
        end if;
        update leonx_private.release_watch
           set last_build_id = v_json ->> 'buildId', last_version = left(v_json ->> 'version', 20), last_error = null
         where singleton;
      elsif v_json is null then
        update leonx_private.release_watch set last_error = 'version.json okunamadı' where singleton;
      else
        update leonx_private.release_watch set last_error = null where singleton;
      end if;
    elsif v_status is not null then
      update leonx_private.release_watch set last_error = 'HTTP ' || v_status where singleton;
    end if;
    -- 019: her yanıt kaydedilir (yanıt yoksa da: istek zaman aşımı / bağlantı hatası)
    insert into leonx_private.uptime_checks (url, ok, status_code, error, build_id)
    values (w.version_url, v_status = 200 and v_json is not null, v_status,
            left(coalesce(v_err, case when v_tout then 'zaman aşımı' end, case when v_status is null then 'yanıt yok' end), 300),
            left(v_json ->> 'buildId', 150));
    -- 3 ardışık hata → tek sistem bildirimi (gün başına bir kez)
    select count(*) into v_fails from (select ok from leonx_private.uptime_checks order by checked_at desc limit 3) t where not ok;
    if v_fails = 3 then
      perform public.leonx_notify('sistem', 'uretim_erisim', 'LEONX OS production adresine ulaşılamıyor',
        'Sunucu tarafı izleme 3 ardışık denemede ' || w.version_url || ' adresine ulaşamadı (' || coalesce(v_err, 'HTTP ' || v_status, 'yanıt yok') || ').',
        '/ayarlar', null, null, 'uretim_erisim:' || to_char(now() at time zone 'UTC', 'YYYYMMDD'), true);
    end if;
  end if;
  if to_regprocedure('net.http_get(text,jsonb,jsonb,integer)') is null then
    return;
  end if;
  execute 'select net.http_get(url := $1, params := $2, headers := $3, timeout_milliseconds := 10000)'
    into v_id using w.version_url, jsonb_build_object('t', extract(epoch from now())::bigint::text), '{"Cache-Control":"no-cache"}'::jsonb;
  update leonx_private.release_watch set pending_id = v_id, checked_at = now() where singleton;
end;
$$;
revoke all on function leonx_private.check_release() from public, anon, authenticated;

/** Panel için erişim izleme özeti (yalnız sahip) */
create or replace function public.uptime_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then raise exception 'Yetkisiz' using errcode = '42501'; end if;
  return jsonb_build_object(
    'url', (select version_url from leonx_private.release_watch where singleton),
    'last', (select to_jsonb(t) from (select checked_at, ok, status_code, error, build_id from leonx_private.uptime_checks order by checked_at desc limit 1) t),
    'checks_24h', (select count(*) from leonx_private.uptime_checks where checked_at >= now() - interval '24 hours'),
    'failures_24h', (select count(*) from leonx_private.uptime_checks where checked_at >= now() - interval '24 hours' and not ok),
    'last_failure', (select to_jsonb(t) from (select checked_at, status_code, error from leonx_private.uptime_checks where not ok order by checked_at desc limit 1) t));
end;
$$;
revoke all on function public.uptime_summary() from public, anon;
grant execute on function public.uptime_summary() to authenticated;

-- =====================================================================
-- F) GÜNLÜK YENİDEN DEĞERLENDİRME (radar-scan { "reclassify": true }) — 07:20 TR (04:20 UTC)
--    Saklanan öğeler güncel kurallarla yeniden sınıflandırılır; aşama/sınıf değişimi kaydedilir.
-- =====================================================================
create or replace function leonx_private.dispatch_radar_reclassify()
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
    using v_url, '{"reclassify": true}'::jsonb, jsonb_build_object('Content-Type', 'application/json', 'x-leonx-cron', v_secret);
end;
$$;
revoke all on function leonx_private.dispatch_radar_reclassify() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net') then
    raise notice 'pg_cron / pg_net bulunamadı; yeniden değerlendirme zamanlayıcısı kurulmadı.';
    return;
  end if;
  execute 'create extension if not exists pg_cron';
  execute $q$select cron.schedule('leonx-radar-yeniden', '20 4 * * *', 'select leonx_private.dispatch_radar_reclassify()')$q$;
end;
$$;
