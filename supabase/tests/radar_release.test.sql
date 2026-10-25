-- =====================================================================
-- LEONX OS — 017: Radar yayın hazırlığı testleri
-- Tek işlem içinde çalışır ve sonunda ROLLBACK yapar; kalıcı veri bırakmaz.
-- Tüm fırsat/firma verileri SENTETİKTİR.
-- =====================================================================
begin;

select set_config('leonx.owner', (select user_id::text from public.app_owner), true);

create or replace function pg_temp.act_as(p_user text)
returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- =====================================================================
-- A) YETKİLER
-- =====================================================================
do $$
declare f text;
begin
  foreach f in array array['public.owner_login_check(text)', 'public.owner_login_record(text, boolean)',
    'public.radar_rescore_breakdown(jsonb, integer, integer)', 'public.tg_radar_opportunity_rescore()', 'public.tg_radar_contacts_rescore()'] loop
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') then
      raise exception 'TEST BAŞARISIZ: % istemciye açık', f;
    end if;
  end loop;
  if not has_function_privilege('service_role', 'public.owner_login_record(text, boolean)', 'execute') then
    raise exception 'TEST BAŞARISIZ: owner_login_record service_role için kapalı';
  end if;
  if has_table_privilege('authenticated', 'leonx_private.owner_login_attempts', 'select')
     or has_table_privilege('anon', 'leonx_private.owner_login_attempts', 'select') then
    raise exception 'TEST BAŞARISIZ: giriş sayaçları istemciye açık';
  end if;
  raise notice 'PASS A: giriş koruması ve yeniden puanlama işlevleri istemciye kapalı';
end;
$$;

-- =====================================================================
-- B) GİRİŞ KORUMASI
-- =====================================================================
do $$
declare
  v_a text := repeat('a', 64);
  v_b text := repeat('b', 64);
  w integer;
  i integer;
begin
  if public.owner_login_check(v_a) <> 0 then raise exception 'TEST BAŞARISIZ: temiz istemci bekletildi'; end if;
  for i in 1..4 loop
    w := public.owner_login_record(v_a, false);
  end loop;
  if w <> 0 then raise exception 'TEST BAŞARISIZ: 4 hatada kilit (beklenen 0, gelen %)', w; end if;
  w := public.owner_login_record(v_a, false);
  if w < 25 or w > 30 then raise exception 'TEST BAŞARISIZ: 5. hatada 30 sn kilit bekleniyordu (gelen %)', w; end if;
  w := public.owner_login_record(v_a, false);
  if w < 55 or w > 60 then raise exception 'TEST BAŞARISIZ: kilit ilerlemeli artmadı (gelen %)', w; end if;
  if public.owner_login_check(v_b) <> 0 then raise exception 'TEST BAŞARISIZ: başka IP de kilitlendi'; end if;
  -- Başarılı giriş yalnız o IP'nin sayacını sıfırlar
  perform public.owner_login_record(v_b, false);
  perform public.owner_login_record(v_b, true);
  if exists (select 1 from leonx_private.owner_login_attempts where bucket = 'ip:' || v_b) then
    raise exception 'TEST BAŞARISIZ: başarılı girişten sonra sayaç silinmedi';
  end if;
  -- Pencere süresi geçince sayaç baştan başlar
  update leonx_private.owner_login_attempts set window_start = now() - interval '20 minutes', locked_until = now() - interval '1 second' where bucket = 'ip:' || v_a;
  w := public.owner_login_record(v_a, false);
  if w <> 0 or (select failures from leonx_private.owner_login_attempts where bucket = 'ip:' || v_a) <> 1 then
    raise exception 'TEST BAŞARISIZ: süresi geçen pencere sıfırlanmadı';
  end if;
  -- Genel sınır: 50 hata → herkes beklemeye alınır
  update leonx_private.owner_login_attempts set failures = 49, window_start = now() where bucket = 'global';
  perform public.owner_login_record(repeat('c', 64), false);
  if public.owner_login_check(repeat('d', 64)) < 250 then raise exception 'TEST BAŞARISIZ: genel kilit uygulanmadı'; end if;
  begin
    perform public.owner_login_check('1.2.3.4');
    raise exception 'TEST BAŞARISIZ: açık IP adresi kabul edildi';
  exception when sqlstate '22023' then null;
  end;
  if exists (select 1 from leonx_private.owner_login_attempts where bucket !~ '^(global|ip:[0-9a-f]{64})$') then
    raise exception 'TEST BAŞARISIZ: sayaçta açık metin anahtar var';
  end if;
  raise notice 'PASS B: IP başına ilerlemeli kilit, genel sınır, başarıda sıfırlama, yalnız özet (hash) anahtar';
end;
$$;

-- =====================================================================
-- C) İLETİŞİM ETKENİ YENİDEN HESAPLANIR
-- =====================================================================
do $$
declare
  v_o uuid;
  v_c uuid;
  v_k uuid;
  v_part jsonb;
  v_score integer;
begin
  insert into public.radar_opportunities (title, city, is_ankara, stage, score, score_breakdown, label, cluster_key)
  values ('SENTETİK Ankara hastane doğrama', 'Ankara', true, 'ihale', 50,
    '[{"key":"kategori","label":"Kategori","weight":25,"factor":1,"points":25,"reason":"x"},
      {"key":"iletisim","label":"İletişim","weight":10,"factor":0.3,"points":3,"reason":"Kurum/firma adı biliniyor, iletişim doğrulanmadı","base_factor":0.3,"base_reason":"Kurum/firma adı biliniyor, iletişim doğrulanmadı"},
      {"key":"yakinlik","label":"Yakınlık","weight":15,"factor":1,"points":15,"reason":"Ankara"}]'::jsonb,
    'potansiyel_ihtiyac', 'sentetik-iletisim-1')
  returning id into v_o;
  insert into public.radar_companies (name, normalized_name, website) values ('Sentetik Yapı A.Ş.', 'sentetik yapi', 'https://sentetik.example') returning id into v_c;
  insert into public.radar_opportunity_companies (opportunity_id, company_id, role) values (v_o, v_c, 'ana_yuklenici');
  if (select score from public.radar_opportunities where id = v_o) <> 43 then
    raise exception 'TEST BAŞARISIZ: kanalsız puan 43 olmalı (gelen %)', (select score from public.radar_opportunities where id = v_o);
  end if;

  insert into public.radar_contacts (company_id, kind, value, source_url, verified_at)
  values (v_c, 'genel_eposta', 'info@sentetik.example', 'https://sentetik.example/iletisim', now()) returning id into v_k;
  select score, (select x from jsonb_array_elements(score_breakdown) x where x ->> 'key' = 'iletisim') into v_score, v_part from public.radar_opportunities where id = v_o;
  if v_score <> 47 or (v_part ->> 'factor')::numeric <> 0.7 then
    raise exception 'TEST BAŞARISIZ: genel kanal sonrası puan 47 / etken 0.7 olmalı (gelen % / %)', v_score, v_part ->> 'factor';
  end if;

  insert into public.radar_contacts (company_id, kind, value, source_url, verified_at)
  values (v_c, 'satinalma_eposta', 'satinalma@sentetik.example', 'https://sentetik.example/tedarikci', now());
  select score into v_score from public.radar_opportunities where id = v_o;
  if v_score <> 50 then raise exception 'TEST BAŞARISIZ: satın alma kanalı sonrası puan 50 olmalı (gelen %)', v_score; end if;

  delete from public.radar_contacts where company_id = v_c;
  select score, (select x from jsonb_array_elements(score_breakdown) x where x ->> 'key' = 'iletisim') into v_score, v_part from public.radar_opportunities where id = v_o;
  if v_score <> 43 or v_part ->> 'reason' <> 'Kurum/firma adı biliniyor, iletişim doğrulanmadı' then
    raise exception 'TEST BAŞARISIZ: kanal silinince taban değere dönülmedi (gelen %)', v_score;
  end if;

  -- Tarama aynı fırsatı daha düşük iletişim etkeniyle yeniden yazsa da kayıtlı kanal korunur
  insert into public.radar_contacts (company_id, kind, value, source_url, verified_at)
  values (v_c, 'tedarikci_portali', 'https://sentetik.example/tedarikci', 'https://sentetik.example/tedarikci', now());
  update public.radar_opportunities set score_breakdown =
    '[{"key":"iletisim","label":"İletişim","weight":10,"factor":0,"points":0,"reason":"Teklif yolu belirsiz","base_factor":0,"base_reason":"Teklif yolu belirsiz"}]'::jsonb
   where id = v_o;
  if (select score from public.radar_opportunities where id = v_o) <> 10 then
    raise exception 'TEST BAŞARISIZ: yeniden yazılan dökümde kanal etkeni korunmadı';
  end if;
  raise notice 'PASS C: iletişim kanalı eklenince/silinince puan ve gerekçe yeniden hesaplanır';
end;
$$;

-- =====================================================================
-- D) FIRSAT BAŞINA TEK TEKLİF TASLAĞI
-- =====================================================================
set local role authenticated;
select pg_temp.act_as(current_setting('leonx.owner'));
do $$
declare
  v_o uuid;
  v_company uuid;
  v_q uuid;
begin
  select id into v_o from public.radar_opportunities where cluster_key = 'sentetik-iletisim-1';
  insert into public.companies (name) values ('SENTETİK Teklif Firması') returning id into v_company;
  insert into public.quotes (company_id, title, radar_opportunity_id) values (v_company, 'SENTETİK fırsat teklifi', v_o) returning id into v_q;
  begin
    insert into public.quotes (company_id, title, radar_opportunity_id) values (v_company, 'İkinci taslak', v_o);
    raise exception 'TEST BAŞARISIZ: aynı fırsata ikinci teklif açıldı';
  exception when unique_violation then null;
  end;
  if (select count(*) from public.quote_items where quote_id = v_q) <> 0 then
    raise exception 'TEST BAŞARISIZ: fırsattan açılan taslakta kalem/fiyat üretildi';
  end if;
  raise notice 'PASS D: fırsattan teklif taslağı tekil; kalem ve fiyat üretilmez';
end;
$$;
reset role;

do $$ begin raise notice 'TESTLER BAŞARILI (radar yayın)'; end $$;
rollback;
