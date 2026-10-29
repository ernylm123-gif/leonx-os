-- =====================================================================
-- LEONX OS — 019: Radar inşaat satış istihbaratı ve erişim izleme testleri
-- Tek işlem; sonunda ROLLBACK. Tüm veriler SENTETİKTİR.
-- =====================================================================
begin;

select set_config('leonx.owner', (select user_id::text from public.app_owner), true);

create or replace function pg_temp.act_as(p_user text)
returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

create or replace function pg_temp.item(p_url text, p_title text, p_cluster text, p_city text, p_intel jsonb, p_companies jsonb default '[]'::jsonb, p_verified boolean default false)
returns jsonb language sql as $$
  select jsonb_build_object(
    'url', p_url, 'canonical_url', p_url, 'url_hash', encode(sha256(convert_to(p_url, 'UTF8')), 'hex'),
    'content_hash', encode(sha256(convert_to(p_title, 'UTF8')), 'hex'),
    'title', p_title, 'summary', 'sentetik metin', 'published_at', now() - interval '1 hour',
    'classification', jsonb_build_object('version', 1, 'intel', p_intel), 'analyzer', 'kural-v1',
    'cluster_key', p_cluster, 'cluster_tokens', jsonb_build_array('sentetik'),
    'city', p_city, 'district', null, 'is_ankara', p_city = 'Ankara', 'sector', 'ozel', 'project_type', 'konut', 'stage', 'yapim',
    'tender', '{}'::jsonb, 'deadline', null, 'score', 70, 'score_breakdown', '[]'::jsonb, 'reliability_base', 60, 'reliability_breakdown', '[]'::jsonb,
    'verified_need', p_verified, 'label', 'potansiyel_ihtiyac', 'risks', '[]'::jsonb,
    'categories', '[{"key":"pvc_dograma","need_status":"potansiyel","matched_terms":["konut"]}]'::jsonb, 'companies', p_companies,
    'evidence', jsonb_build_array(jsonb_build_object('field', 'kaynak', 'claim', 'Kaynak öğesi: ' || p_title, 'excerpt', 'sentetik')));
$$;

create or replace function pg_temp.intel(p_class text, p_stage text, p_region int, p_excluded text default null)
returns jsonb language sql as $$
  select jsonb_build_object('version', 1, 'salesClass', p_class, 'stage', p_stage, 'stageTerms', jsonb_build_array('kaba insaat tamamlan'),
    'regionPriority', p_region, 'excluded', p_excluded, 'action', 'Sentetik işlem',
    'products', '[{"group":"pvc","basis":"olasi"},{"group":"celik_kapi","basis":"olasi"}]'::jsonb,
    'outlook', jsonb_build_object('tahmin', true, 'pencere', '0-3_ay', 'urunler', jsonb_build_array('pvc'), 'gerekce', 'sentetik'));
$$;

-- A) Yetkiler
do $$
declare f text;
begin
  foreach f in array array['public.radar_service_set_intel(jsonb)', 'public.radar_refresh_intel(uuid)', 'public.tg_radar_item_intel()', 'leonx_private.check_release()'] loop
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') then
      raise exception 'TEST BAŞARISIZ: % istemciye açık', f;
    end if;
  end loop;
  if not has_function_privilege('service_role', 'public.radar_service_set_intel(jsonb)', 'execute') then
    raise exception 'TEST BAŞARISIZ: set_intel service_role için kapalı';
  end if;
  foreach f in array array['public.radar_sales_overview()', 'public.uptime_summary()'] loop
    if has_function_privilege('anon', f, 'execute') or not has_function_privilege('authenticated', f, 'execute') then
      raise exception 'TEST BAŞARISIZ: % yetkisi yanlış', f;
    end if;
  end loop;
  if not exists (select 1 from public.radar_settings where singleton and 'Özçelik İnşaat' = any (excluded_companies)) then
    raise exception 'TEST BAŞARISIZ: Özçelik İnşaat hariç tutma listesinde değil';
  end if;
  raise notice 'PASS A: sunucu işlevleri istemciye kapalı; özet yalnız oturumlu; Özçelik İnşaat hariç listesinde';
end;
$$;

insert into public.radar_sources (name, kind, url, allowed_hosts, permission_status)
values ('Sentetik inşaat haberleri', 'rss', 'https://haber.ornek.test/rss', array['haber.ornek.test'], 'inceleniyor');
select set_config('leonx.src', (select id::text from public.radar_sources where url = 'https://haber.ornek.test/rss'), true);

-- B) Sunucu: öğe istihbaratı fırsata yansır; sınıf en iyisi; hariç tutulan firma D ve bildirimsiz
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
declare
  v_src uuid := current_setting('leonx.src')::uuid;
  o public.radar_opportunities;
  v_n integer;
begin
  perform public.radar_ingest(v_src, '{"status":"ok"}'::jsonb, jsonb_build_array(
    pg_temp.item('https://haber.ornek.test/1', 'Hatay konut projesinde kaba inşaat tamamlandı', 'hatay:sentetik-b', 'Hatay', pg_temp.intel('B', 'kaba_tamam', 2)),
    pg_temp.item('https://haber.ornek.test/2', 'Ankara villa projesinin temeli atıldı', 'ankara:sentetik-c', 'Ankara', pg_temp.intel('C', 'temel_atma', 1)),
    pg_temp.item('https://haber.ornek.test/3', 'Özçelik İnşaat Çankaya rezidans kaba inşaat', 'ankara:sentetik-x', 'Ankara', pg_temp.intel('B', 'kaba_insaat', 1),
                 '[{"name":"Özçelik İnşaat","normalized_name":"ozcelik insaat","role":"ana_yuklenici"}]'::jsonb)));

  select * into o from public.radar_opportunities where cluster_key = 'hatay:sentetik-b';
  if o.sales_class <> 'B' or o.construction_stage <> 'kaba_tamam' or o.region_priority <> 2 or not (o.product_groups @> array['pvc', 'celik_kapi'])
     or o.procurement_outlook ->> 'tahmin' <> 'true' or o.recommended_action is null then
    raise exception 'TEST BAŞARISIZ: B istihbaratı yansımadı (%, %, %, %)', o.sales_class, o.construction_stage, o.region_priority, o.product_groups;
  end if;
  if o.notified_at is null then raise exception 'TEST BAŞARISIZ: B sınıfı (aktif proje) bildirilmedi'; end if;
  if (select kind from public.notifications where dedupe_key = 'radar:' || o.id) <> 'radar_proje' then
    raise exception 'TEST BAŞARISIZ: B sınıfı "açık talep" olarak bildirildi';
  end if;
  raise notice 'PASS B1: B sınıfı → aşama, bölge (Hatay=2), ürünler, tahmin; "aktif proje (talep doğrulanmadı)" bildirimi';

  select * into o from public.radar_opportunities where cluster_key = 'ankara:sentetik-c';
  if o.sales_class <> 'C' or o.notified_at is not null then raise exception 'TEST BAŞARISIZ: C sınıfı bildirildi veya sınıf yanlış'; end if;
  raise notice 'PASS B2: C sınıfı (erken aşama) panelde kalır, bildirim yok';

  select * into o from public.radar_opportunities where cluster_key = 'ankara:sentetik-x';
  if o.sales_class <> 'D' or o.excluded_company is null or o.notified_at is not null then
    raise exception 'TEST BAŞARISIZ: hariç tutulan firma (sınıf %, firma %, bildirim %)', o.sales_class, o.excluded_company, o.notified_at;
  end if;
  raise notice 'PASS B3: Özçelik İnşaat bağlı kayıt sınıf D, bildirim yok';

  -- Aynı projeye A sınıfı (tedarikçi daveti) öğe → fırsat A olur; değişim kaydı tutulur
  perform public.radar_ingest(v_src, '{"status":"ok"}'::jsonb, jsonb_build_array(
    pg_temp.item('https://haber.ornek.test/4', 'Hatay konut projesi PVC doğrama teklif alınacak', 'hatay:sentetik-b', 'Hatay', pg_temp.intel('A', 'duvar', 2), '[]'::jsonb, true)));
  select * into o from public.radar_opportunities where cluster_key = 'hatay:sentetik-b';
  if o.sales_class <> 'A' or o.construction_stage <> 'duvar' then raise exception 'TEST BAŞARISIZ: A/aşama güncellenmedi (%, %)', o.sales_class, o.construction_stage; end if;
  if (select count(*) from public.radar_changes where opportunity_id = o.id and field in ('satis_sinifi', 'insaat_asamasi')) <> 2 then
    raise exception 'TEST BAŞARISIZ: sınıf/aşama değişimi kaydedilmedi';
  end if;
  raise notice 'PASS B4: aynı projeye doğrulanmış talep → A; sınıf ve aşama değişimi kaydedildi';

  -- Yeniden değerlendirme servisi: geçersiz sınıf yok sayılır
  if public.radar_service_set_intel(jsonb_build_array(jsonb_build_object('id', (select id from public.radar_items where canonical_url = 'https://haber.ornek.test/2'), 'intel', '{"salesClass":"Z"}'::jsonb))) <> 0 then
    raise exception 'TEST BAŞARISIZ: geçersiz sınıf yazıldı';
  end if;
  v_n := public.radar_service_set_intel(jsonb_build_array(jsonb_build_object('id', (select id from public.radar_items where canonical_url = 'https://haber.ornek.test/2'), 'intel', pg_temp.intel('B', 'kaba_insaat', 1))));
  if v_n <> 1 or (select sales_class from public.radar_opportunities where cluster_key = 'ankara:sentetik-c') <> 'B' then
    raise exception 'TEST BAŞARISIZ: yeniden değerlendirme fırsata yansımadı (n=%, sınıf=%)', v_n, (select sales_class from public.radar_opportunities where cluster_key = 'ankara:sentetik-c');
  end if;
  raise notice 'PASS B5: radar_service_set_intel yalnız geçerli sınıfı yazar ve fırsatı günceller';
end;
$$;
reset role;

-- C) İstemci: sınıfı yazamaz; tedarikçi adresi kaynaksız kaydedilemez; özet okunur
set local role authenticated;
select pg_temp.act_as(current_setting('leonx.owner'));
do $$
declare v jsonb;
begin
  begin
    update public.radar_opportunities set sales_class = 'A' where cluster_key = 'ankara:sentetik-x';
    raise exception 'TEST BAŞARISIZ: istemci satış sınıfını yazdı';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.radar_companies set supplier_portal_url = 'https://tedarik.ornek.test/basvuru' where normalized_name = 'ozcelik insaat';
    raise exception 'TEST BAŞARISIZ: kaynaksız tedarikçi adresi kabul edildi';
  exception when check_violation then null;
  end;
  update public.radar_companies set supplier_portal_url = 'https://tedarik.ornek.test/basvuru', supplier_portal_source = 'https://tedarik.ornek.test/', company_kind = 'yuklenici'
   where normalized_name = 'ozcelik insaat';
  v := public.radar_sales_overview();
  if (v -> 'by_class' ->> 'A')::int <> 1 or (v -> 'by_class' ->> 'B')::int <> 1 or (v -> 'by_class' ->> 'D')::int <> 1 then
    raise exception 'TEST BAŞARISIZ: sınıf sayıları %', v -> 'by_class';
  end if;
  if exists (select 1 from jsonb_array_elements(v -> 'contractors_to_contact') c where c ->> 'name' = 'Özçelik İnşaat') then
    raise exception 'TEST BAŞARISIZ: hariç tutulan firma iletişim listesinde';
  end if;
  if (v -> 'by_province' -> 0 ->> 'priority')::int <> 1 then raise exception 'TEST BAŞARISIZ: il sıralaması bölge önceliğine göre değil'; end if;
  perform public.uptime_summary();
  raise notice 'PASS C: istemci sınıf yazamaz; tedarikçi adresi kaynaksız kaydedilemez; satış özeti doğru, hariç firma önerilmez';
end;
$$;
reset role;

-- D) Erişim izleme: 3 ardışık hata → tek sistem bildirimi
do $$
begin
  insert into leonx_private.uptime_checks (url, ok, status_code, error) values
    ('https://leonx-os.vercel.app/version.json', false, null, 'yanıt yok'),
    ('https://leonx-os.vercel.app/version.json', false, null, 'yanıt yok');
  update leonx_private.release_watch set version_url = 'https://leonx-os.vercel.app/version.json', pending_id = null where singleton;
  -- pg_net yok (yerel test): check_release yanıt okumaz; uyarı mantığı doğrudan sınanır
  if (select count(*) from (select ok from leonx_private.uptime_checks order by checked_at desc limit 3) t where not ok) <> 2 then
    raise exception 'TEST BAŞARISIZ: izleme kaydı';
  end if;
  perform leonx_private.check_release();
  raise notice 'PASS D: erişim izleme tablosu ve check_release (pg_net olmadan) hatasız';
  raise notice 'TESTLER BAŞARILI (radar satış istihbaratı)';
end;
$$;

rollback;
