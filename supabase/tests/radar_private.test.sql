-- =====================================================================
-- LEONX OS â€” 020: Ã–zel sektÃ¶r keÅŸfi, yÃ¼klenici dizini, e-posta kuyruÄŸu testleri
-- Tek iÅŸlem; sonunda ROLLBACK. TÃ¼m veriler SENTETÄ°KTÄ°R (alan adlarÄ± .test).
-- =====================================================================
begin;

select set_config('leonx.owner', (select user_id::text from public.app_owner), true);

create or replace function pg_temp.act_as(p_user text)
returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

create or replace function pg_temp.item(p_url text, p_title text, p_cluster text, p_sector text)
returns jsonb language sql as $$
  select jsonb_build_object(
    'url', p_url, 'canonical_url', p_url, 'url_hash', encode(sha256(convert_to(p_url, 'UTF8')), 'hex'),
    'content_hash', encode(sha256(convert_to(p_title, 'UTF8')), 'hex'),
    'title', p_title, 'summary', 'sentetik metin', 'published_at', now() - interval '10 days',
    'classification', jsonb_build_object('version', 1), 'analyzer', 'kural-v1',
    'cluster_key', p_cluster, 'cluster_tokens', jsonb_build_array('sentetik'),
    'city', 'Ankara', 'district', 'Sincan', 'is_ankara', true, 'sector', p_sector, 'project_type', 'konut', 'stage', 'yapim',
    'tender', '{}'::jsonb, 'deadline', null, 'score', 39, 'score_breakdown', '[]'::jsonb, 'reliability_base', 30, 'reliability_breakdown', '[]'::jsonb,
    'verified_need', false, 'label', 'potansiyel_ihtiyac', 'risks', '[]'::jsonb,
    'categories', '[{"key":"pvc_dograma","need_status":"potansiyel","matched_terms":["konut"]}]'::jsonb, 'companies', '[]'::jsonb,
    'evidence', jsonb_build_array(jsonb_build_object('field', 'kaynak', 'claim', 'Kaynak Ã¶ÄŸesi: ' || p_title, 'excerpt', 'sentetik')));
$$;

create or replace function pg_temp.breakdown()
returns jsonb language sql as $$
  select '[{"key":"urun","weight":22,"factor":0.6,"points":13.2,"reason":"r"},{"key":"asama","weight":20,"factor":1,"points":20,"reason":"r"},
           {"key":"guncellik","weight":15,"factor":1,"points":15,"reason":"r"},{"key":"cografya","weight":12,"factor":1,"points":12,"reason":"r"},
           {"key":"talep","weight":12,"factor":0,"points":0,"reason":"r"},{"key":"iletisim","weight":10,"factor":0.4,"points":4,"reason":"r"},
           {"key":"gecmis","weight":4,"factor":1,"points":4,"reason":"r"},{"key":"olcek","weight":5,"factor":1,"points":5,"reason":"r"}]'::jsonb;
$$;

-- A) Yetkiler, varsayÄ±lanlar, keÅŸif kaynaÄŸÄ±
do $$
declare f text;
begin
  foreach f in array array['public.radar_service_discovery_save(jsonb)', 'public.radar_service_discovery_config()', 'public.radar_service_due_companies(integer)',
    'public.radar_service_outreach_candidates(integer)', 'public.radar_service_save_drafts(jsonb)', 'public.radar_service_send_queue(integer)',
    'public.radar_service_record_send(jsonb)', 'public.radar_service_gmail_status(boolean, jsonb)', 'public.radar_private_finalize(uuid)',
    'leonx_private.dispatch_radar_discover()', 'leonx_private.dispatch_radar_outreach()'] loop
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') then
      raise exception 'TEST BAÅARISIZ: % istemciye aÃ§Ä±k', f;
    end if;
  end loop;
  if not has_function_privilege('service_role', 'public.radar_service_discovery_save(jsonb)', 'execute') then
    raise exception 'TEST BAÅARISIZ: discovery_save service_role iÃ§in kapalÄ±';
  end if;
  foreach f in array array['public.radar_private_overview()', 'public.radar_district_coverage()'] loop
    if has_function_privilege('anon', f, 'execute') or not has_function_privilege('authenticated', f, 'execute') then
      raise exception 'TEST BAÅARISIZ: % yetkisi yanlÄ±ÅŸ', f;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.radar_outreach_sends', 'insert') or has_table_privilege('authenticated', 'public.radar_discovery_runs', 'insert') then
    raise exception 'TEST BAÅARISIZ: istemci gÃ¶nderim defterine / keÅŸif kaydÄ±na yazabiliyor';
  end if;
  if (select count(*) from public.radar_sources where kind = 'search_api' and sector_hint = 'ozel' and permission_status = 'inceleniyor' and not active) <> 1 then
    raise exception 'TEST BAÅARISIZ: keÅŸif kaynaÄŸÄ± inceleniyor+pasif olarak tek kez eklenmedi';
  end if;
  if exists (select 1 from public.radar_settings where outreach_auto_send or discovery_enabled or gmail_verified_at is not null) then
    raise exception 'TEST BAÅARISIZ: keÅŸif/otomatik gÃ¶nderim varsayÄ±lan olarak aÃ§Ä±k';
  end if;
  raise notice 'PASS A: sunucu iÅŸlevleri ve defterler istemciye kapalÄ±; keÅŸif kaynaÄŸÄ± Ä°nceleniyor + pasif; otomatik gÃ¶nderim kapalÄ±';
end;
$$;

-- B) Otomatik gÃ¶nderim Gmail doÄŸrulanmadan ve hukuki dayanak belgelenmeden aÃ§Ä±lamaz; gÃ¶nderen sabit
set local role authenticated;
select pg_temp.act_as(current_setting('leonx.owner'));
do $$
begin
  begin
    update public.radar_settings set outreach_auto_send = true where singleton;
    raise exception 'TEST BAÅARISIZ: otomatik gÃ¶nderim Gmail doÄŸrulamasÄ± olmadan aÃ§Ä±ldÄ±';
  exception when check_violation then null;
  end;
  begin
    update public.radar_settings set gmail_verified_at = now() where singleton;
    raise exception 'TEST BAÅARISIZ: istemci Gmail doÄŸrulamasÄ±nÄ± yazdÄ±';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.radar_settings set gmail_sender = 'baska@ornek.test' where singleton;
    raise exception 'TEST BAÅARISIZ: gÃ¶nderen adres deÄŸiÅŸtirildi';
  exception when insufficient_privilege then null;
  end;
  update public.radar_settings set discovery_enabled = true, discovery_queries_per_run = 2, outreach_legal_note = 'Sentetik not', outreach_legal_confirmed_at = now() where singleton;
  raise notice 'PASS B: otomatik gÃ¶nderim kilitli (Gmail + hukuki dayanak); gÃ¶nderen erlindoorkapi@gmail.com sabit; keÅŸif ayarÄ± sahipÃ§e aÃ§Ä±labilir';
end;
$$;
reset role;

-- C) Sunucu: keÅŸif kaydÄ± â†’ firma dizini, kanÄ±tlÄ± aÅŸama, puan, bÃ¶lÃ¼mler, sorgu/sonuÃ§ kayÄ±tlarÄ±
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
declare
  v_src uuid := (select id from public.radar_sources where kind = 'search_api' and sector_hint = 'ozel');
  v_r   jsonb;
  o     public.radar_opportunities;
  c     public.radar_companies;
  v_cfg jsonb;
begin
  v_cfg := public.radar_service_discovery_config();
  if v_cfg -> 'source' ->> 'id' <> v_src::text or (v_cfg -> 'settings' ->> 'discovery_enabled')::boolean is not true then
    raise exception 'TEST BAÅARISIZ: keÅŸif yapÄ±landÄ±rmasÄ± %', v_cfg;
  end if;
  if exists (select 1 from public.radar_service_claim_sources(10) s where s.id = v_src) then
    raise exception 'TEST BAÅARISIZ: keÅŸif kaynaÄŸÄ± genel taramaya kiralandÄ±';
  end if;
  perform public.radar_ingest(v_src, '{"status":"ok"}'::jsonb, jsonb_build_array(
    pg_temp.item('https://www.ornekyapi.test/projelerimiz/sincan', 'Sincan 12 daireli apartman projemiz', 'ankara:ozel-1', 'bilinmiyor'),
    pg_temp.item('https://www.ankara.bel.test/ihale/1', 'Hizmet binasÄ± yangÄ±n kapÄ±sÄ± ihalesi', 'ankara:kamu-1', 'kamu')));
  v_r := public.radar_service_discovery_save(jsonb_build_object(
    'run_started_at', now() - interval '1 minute',
    'items', jsonb_build_array(
      jsonb_build_object('url_hash', encode(sha256(convert_to('https://www.ornekyapi.test/projelerimiz/sincan', 'UTF8')), 'hex'),
        'page_kind', 'firma_proje_sayfasi', 'sector', 'ozel', 'discovered_via', 'arama', 'unit_count', 12, 'unit_text', '12 daireli', 'size_band', 'yerel',
        'stage_display', 'Kaba inÅŸaat / karkas', 'stage_confidence', 'yuksek', 'stage_active', true, 'stage_new_start', false,
        'stage_evidence_url', 'https://www.ornekyapi.test/projelerimiz/sincan', 'stage_evidence_at', now() - interval '10 days', 'stage_explanation', 'sentetik',
        'procurement_status', 'potansiyel', 'relevance_explanation', 'Sentetik aÃ§Ä±klama', 'segments', '["ozel_proje","aktif_santiye"]'::jsonb,
        'private_score', 73, 'private_score_breakdown', pg_temp.breakdown(),
        'company', jsonb_build_object('name', 'Ã–rnek YapÄ± Ä°nÅŸaat Ltd. Åti.', 'normalized_name', 'ornek yapi insaat ltd sti', 'name_basis', 'metin',
          'website', 'https://www.ornekyapi.test', 'sector', 'ozel', 'size_band', 'yerel', 'contractor_kind', 'muteahhit', 'company_kind', 'yuklenici',
          'city', 'Ankara', 'district', 'Sincan', 'discovery_source', 'arama', 'discovery_url', 'https://www.ornekyapi.test/projelerimiz/sincan', 'discovery_query', 'Sincan Ankara yeni apartman projesi')),
      -- Tarihsiz kanÄ±t "aktif" yazÄ±lmaya Ã§alÄ±ÅŸÄ±lÄ±rsa veritabanÄ± kÄ±sÄ±tÄ± reddeder (aÅŸaÄŸÄ±da ayrÄ±ca sÄ±nanÄ±r)
      jsonb_build_object('url_hash', encode(sha256(convert_to('https://www.ankara.bel.test/ihale/1', 'UTF8')), 'hex'),
        'page_kind', 'kamu', 'sector', 'kamu', 'discovered_via', 'arama', 'size_band', 'bilinmiyor', 'stage_display', 'AÅŸama doÄŸrulanamadÄ±',
        'stage_active', null, 'stage_new_start', false, 'stage_explanation', 'sentetik', 'procurement_status', 'dogrulanmis_talep',
        'segments', '["kamu_ihale"]'::jsonb, 'private_score', 50, 'private_score_breakdown', '[]'::jsonb, 'company', null)),
    'queries', jsonb_build_array(jsonb_build_object('key', 'apartman|ankara|sincan', 'pattern', 'apartman', 'family', 'proje', 'city', 'Ankara', 'district', 'Sincan',
      'query', 'Sincan Ankara yeni apartman projesi', 'results', 2, 'new_results', 2, 'status', 'ok')),
    'seen', jsonb_build_array(jsonb_build_object('url_hash', encode(sha256(convert_to('https://www.ornekyapi.test/projelerimiz/sincan', 'UTF8')), 'hex'),
      'url', 'https://www.ornekyapi.test/projelerimiz/sincan', 'domain', 'www.ornekyapi.test', 'query_key', 'apartman|ankara|sincan', 'page_kind', 'firma_proje_sayfasi', 'outcome', 'firsat'))));
  if (v_r ->> 'companies_new')::int <> 1 or (v_r ->> 'projects_new')::int <> 2 then raise exception 'TEST BAÅARISIZ: sayÄ±mlar %', v_r; end if;
  select * into o from public.radar_opportunities where cluster_key = 'ankara:ozel-1';
  if o.sector <> 'ozel' or not ('aktif_santiye' = any (o.segments)) or o.stage_active is not true or o.stage_evidence_at is null or o.unit_count <> 12 then
    raise exception 'TEST BAÅARISIZ: Ã¶zel proje alanlarÄ± (%, %, %)', o.sector, o.segments, o.stage_active;
  end if;
  -- Firma sitesi biliniyor â†’ iletiÅŸim etkeni 0,4 (73 puan dÃ¶kÃ¼mÃ¼yle tutarlÄ±)
  if o.private_score <> 73 then raise exception 'TEST BAÅARISIZ: puan %', o.private_score; end if;
  select * into c from public.radar_companies where normalized_name = 'ornek yapi insaat ltd sti';
  if c.website <> 'https://www.ornekyapi.test' or c.website_source <> 'kanit' or not ('Sincan' = any (c.districts)) or c.discovery_source <> 'arama' or c.next_research_at is null then
    raise exception 'TEST BAÅARISIZ: firma dizini (%, %, %)', c.website, c.districts, c.discovery_source;
  end if;
  if not exists (select 1 from public.radar_opportunity_companies where opportunity_id = o.id and company_id = c.id and role = 'proje_sahibi') then
    raise exception 'TEST BAÅARISIZ: firmaâ€“proje baÄŸÄ±';
  end if;
  if (select sector from public.radar_opportunities where cluster_key = 'ankara:kamu-1') <> 'kamu'
     or (select segments from public.radar_opportunities where cluster_key = 'ankara:kamu-1') <> array['kamu_ihale'] then
    raise exception 'TEST BAÅARISIZ: kamu ilanÄ± Kamu Ä°haleleri kanalÄ±nda deÄŸil';
  end if;
  if (select runs from public.radar_discovery_queries where key = 'apartman|ankara|sincan') <> 1 or not exists (select 1 from public.radar_discovery_seen where outcome = 'firsat') then
    raise exception 'TEST BAÅARISIZ: sorgu / gÃ¶rÃ¼len sonuÃ§ kaydÄ±';
  end if;
  begin
    update public.radar_opportunities set stage_active = true, stage_evidence_at = null where id = o.id;
    raise exception 'TEST BAÅARISIZ: kanÄ±t tarihi olmadan aktif ÅŸantiye kabul edildi';
  exception when check_violation then null;
  end;
  raise notice 'PASS C1: keÅŸif â†’ firma dizini, kanÄ±tlÄ± aÅŸama, puan, bÃ¶lÃ¼mler; kamu ayrÄ± kanal; tarihsiz "aktif" reddedilir';

  -- DoÄŸrulanmÄ±ÅŸ satÄ±n alma e-postasÄ± eklenince iletiÅŸim etkeni 1,0 â†’ puan +6
  perform public.radar_service_discovery_save(jsonb_build_object('items', '[]'::jsonb, 'contacts', jsonb_build_array(jsonb_build_object(
    'company_id', c.id, 'kind', 'satinalma_eposta', 'value', 'satinalma@ornekyapi.test', 'source_url', 'https://www.ornekyapi.test/iletisim', 'verified_at', now()),
    jsonb_build_object('company_id', c.id, 'kind', 'genel_eposta', 'value', 'gecersiz', 'source_url', 'https://www.ornekyapi.test/', 'verified_at', now())),
    'companies_checked', jsonb_build_array(jsonb_build_object('id', c.id, 'status', 'ok', 'projects_page_url', 'https://www.ornekyapi.test/projelerimiz/'))));
  if (select private_score from public.radar_opportunities where id = o.id) <> 79 then
    raise exception 'TEST BAÅARISIZ: iletiÅŸim sonrasÄ± puan %', (select private_score from public.radar_opportunities where id = o.id);
  end if;
  if (select count(*) from public.radar_contacts where company_id = c.id) <> 1 then raise exception 'TEST BAÅARISIZ: geÃ§ersiz kanal kaydedildi'; end if;
  raise notice 'PASS C2: doÄŸrulanmÄ±ÅŸ satÄ±n alma kanalÄ± puanÄ± gÃ¼nceller; geÃ§ersiz kanal atlanÄ±r; araÅŸtÄ±rma durumu yazÄ±lÄ±r';

  -- E-posta adayÄ± â†’ sistem taslaÄŸÄ± Ä°NCELEME kuyruÄŸunda; aynÄ± proje+firma iÃ§in ikinci taslak yok
  if jsonb_array_length(public.radar_service_outreach_candidates(10)) <> 1 then raise exception 'TEST BAÅARISIZ: e-posta adayÄ± yok'; end if;
  if public.radar_service_save_drafts(jsonb_build_array(jsonb_build_object('opportunity_id', o.id, 'company_id', c.id,
       'contact_id', (select id from public.radar_contacts where company_id = c.id), 'subject', 'Sentetik konu', 'body', 'Sentetik gÃ¶vde',
       'brands', '["leonx_metal","erlin_kapi"]'::jsonb, 'services', '["pvc_dograma"]'::jsonb, 'blocked_reasons', '["otomatik_gonderim_kapali"]'::jsonb))) <> 1 then
    raise exception 'TEST BAÅARISIZ: taslak yazÄ±lmadÄ±';
  end if;
  if (select status from public.radar_outreach_drafts where opportunity_id = o.id) <> 'inceleme' then raise exception 'TEST BAÅARISIZ: taslak inceleme kuyruÄŸunda deÄŸil'; end if;
  if jsonb_array_length(public.radar_service_outreach_candidates(10)) <> 0 then raise exception 'TEST BAÅARISIZ: aynÄ± aday ikinci kez'; end if;
  if jsonb_array_length(public.radar_service_send_queue(5) -> 'drafts') <> 0 then raise exception 'TEST BAÅARISIZ: onaylanmamÄ±ÅŸ taslak gÃ¶nderim kuyruÄŸunda'; end if;
  raise notice 'PASS C3: e-posta adayÄ± â†’ inceleme taslaÄŸÄ±; onaysÄ±z taslak gÃ¶nderim kuyruÄŸuna girmez';

  -- Gmail denetimi baÅŸarÄ±sÄ±zsa doÄŸrulama silinir
  perform public.radar_service_gmail_status(false, '{"error":"kimlik bilgisi yok"}'::jsonb);
  if (select gmail_verified_at from public.radar_settings where singleton) is not null then raise exception 'TEST BAÅARISIZ: baÅŸarÄ±sÄ±z Gmail denetimi doÄŸrulandÄ±'; end if;
  raise notice 'PASS C4: baÅŸarÄ±sÄ±z Gmail denetimi baÄŸlantÄ±yÄ± doÄŸrulanmamÄ±ÅŸ bÄ±rakÄ±r';
end;
$$;
reset role;

-- D) Sahip: onay, yanÄ±t â†’ ret listesi; panel Ã¶zeti ve ilÃ§e kapsamÄ±
set local role authenticated;
select pg_temp.act_as(current_setting('leonx.owner'));
do $$
declare
  v jsonb;
  v_d uuid := (select id from public.radar_outreach_drafts where generated_by = 'sistem' limit 1);
begin
  update public.radar_outreach_drafts set status = 'onaylandi' where id = v_d;
  update public.radar_outreach_drafts set reply_status = 'listeden_cikar' where id = v_d;
  if not exists (select 1 from public.radar_outreach_suppression where value = 'satinalma@ornekyapi.test')
     or not (select opted_out from public.radar_companies where normalized_name = 'ornek yapi insaat ltd sti') then
    raise exception 'TEST BAÅARISIZ: listeden Ã§Ä±kma talebi ret listesine yazÄ±lmadÄ±';
  end if;
  begin
    insert into public.radar_outreach_sends (recipient, status) values ('x@ornek.test', 'gonderildi');
    raise exception 'TEST BAÅARISIZ: istemci sahte gÃ¶nderim kaydÄ± yazdÄ±';
  exception when insufficient_privilege then null;
  end;
  v := public.radar_private_overview();
  if (v -> 'segments' ->> 'ozel_proje')::int <> 1 or (v -> 'segments' ->> 'aktif_santiye')::int <> 1 or (v -> 'segments' ->> 'kamu_ihale')::int < 1
     or (v -> 'performance' ->> 'emails_sent')::int <> 0 or (v -> 'performance' ->> 'replies')::int <> 1 then
    raise exception 'TEST BAÅARISIZ: Ã¶zet %', v;
  end if;
  v := public.radar_district_coverage();
  if jsonb_array_length(v) <> 34 or (select (x ->> 'companies')::int from jsonb_array_elements(v) x where x ->> 'district' = 'Sincan') <> 1 then
    raise exception 'TEST BAÅARISIZ: ilÃ§e kapsamÄ± %', jsonb_array_length(v);
  end if;
  raise notice 'PASS D: onay + "listeden Ã§Ä±kar" yanÄ±tÄ± â†’ ret listesi; sahte gÃ¶nderim yazÄ±lamaz; Ã¶zet ve 25+9 ilÃ§e kapsamÄ±';
end;
$$;
reset role;

-- E) Sunucu: onaylÄ± ama ret listesindeki firma gÃ¶nderim kuyruÄŸunda "suppressed"; ret listesi gÃ¶nderimden Ã¶nce okunur
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
declare v jsonb;
begin
  v := public.radar_service_send_queue(5);
  if jsonb_array_length(v -> 'drafts') <> 1 or (v -> 'drafts' -> 0 ->> 'suppressed')::boolean is not true then
    raise exception 'TEST BAÅARISIZ: gÃ¶nderim kuyruÄŸu ret listesini gÃ¶stermiyor %', v;
  end if;
  if (v -> 'settings' ->> 'auto_send')::boolean then raise exception 'TEST BAÅARISIZ: otomatik gÃ¶nderim aÃ§Ä±k'; end if;
  raise notice 'PASS E: gÃ¶nderim kuyruÄŸu ret listesi ve ayarlarÄ± taÅŸÄ±r (uygunluk sunucuda yeniden denetlenir)';
  raise notice 'TESTLER BAÅARILI (radar Ã¶zel sektÃ¶r)';
end;
$$;
reset role;

rollback;
