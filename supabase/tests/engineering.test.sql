-- =====================================================================
-- LEONX OS — Faz 5.2: mühendislik incelemesi ve metraj izlenebilirliği
-- Tek işlem içinde çalışır ve sonunda ROLLBACK yapar; kalıcı veri bırakmaz.
-- =====================================================================
begin;

select set_config('leonx.owner', (select user_id::text from public.app_owner), true);

create or replace function pg_temp.act_as(p_user text)
returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

do $$
begin
  if has_function_privilege('authenticated', 'public.tg_quantity_item_review()', 'execute')
     or has_function_privilege('anon', 'public.tg_quantity_item_review()', 'execute') then
    raise exception 'TEST BAŞARISIZ: inceleme tetikleyicisi istemciye açık';
  end if;
  raise notice 'PASS E: inceleme tetikleyicisi istemciye kapalı';
end;
$$;

select pg_temp.act_as(current_setting('leonx.owner'));
set local role authenticated;

do $$
declare
  v_owner uuid := current_setting('leonx.owner')::uuid;
  v_c uuid; v_p uuid; v_t uuid; v_i uuid; v_m uuid; v_a uuid;
  r public.quantity_items;
  v_n int;
begin
  insert into public.companies (name) values ('F52 inceleme') returning id into v_c;
  insert into public.projects (code, name, category, company_id) values ('LX-F52-T', 'İnceleme testi', 'cephe', v_c) returning id into v_p;
  insert into public.quantity_takeoffs (project_id, name, revision) values (v_p, 'Metraj', 1) returning id into v_t;

  -- Otomatik tespit: ilk değerler saklanır; istemcinin yazdığı onay bilgisi yok sayılır
  insert into public.quantity_items (takeoff_id, project_id, poz_code, category, width_mm, height_mm, quantity, verification,
    detection, original, approved_by, approved_at)
  values (v_t, v_p, 'P-01', 'pvc_pencere', 1200, 1500, 8, 'bekliyor',
    '{"confidence":0.8,"level":"yuksek","reasons":[],"evidence":[],"suggested_category":"pvc_pencere"}',
    '{"sahte":true}', gen_random_uuid(), now() - interval '1 year')
  returning * into r;
  v_i := r.id;
  if (r.original ->> 'width_mm')::numeric = 1200 and r.original ->> 'quantity' = '8' and r.original -> 'sahte' is null and r.approved_by is null and r.approved_at is null then
    raise notice 'PASS E: tespit edilen pozun ilk değerleri sunucuda saklanır; sahte onay bilgisi yok sayılır';
  else
    raise exception 'TEST BAŞARISIZ: ilk değer / onay bilgisi %', row_to_json(r);
  end if;

  -- Öneri eklenmeden önce düzeltildiyse ilk değer motorun ham sonucudur
  insert into public.quantity_items (takeoff_id, project_id, poz_code, category, width_mm, height_mm, quantity, detection)
  values (v_t, v_p, 'P-03', 'pvc_pencere', 600, 600, 9,
    '{"confidence":0.5,"level":"orta","reasons":[],"evidence":[],"suggested_category":"pvc_pencere","detected":{"width_mm":600,"height_mm":600,"quantity":8,"category":"belirsiz"}}')
  returning * into r;
  if (r.original ->> 'quantity')::int = 8 and r.original ->> 'category' = 'belirsiz' and r.quantity = 9 then
    raise notice 'PASS E: eklemeden önceki düzeltmede ilk değer motorun ham sonucudur';
  else
    raise exception 'TEST BAŞARISIZ: ham değer %', r.original;
  end if;

  -- Elle girilen poz: ilk değer yok
  insert into public.quantity_items (takeoff_id, project_id, poz_code, category, width_mm, height_mm, quantity)
  values (v_t, v_p, 'E1', 'al_pencere', 1000, 1000, 1) returning id into v_m;
  if (select original from public.quantity_items where id = v_m) is null then
    raise notice 'PASS E: elle girilen pozda ilk değer kaydı yok';
  else
    raise exception 'TEST BAŞARISIZ: elle pozda original dolu';
  end if;

  -- Düzeltme: ölçü değişir, ilk değer korunur (değiştirilemez), geçmiş yazılır
  update public.quantity_items set quantity = 9, original = '{"degisti":true}' where id = v_i returning * into r;
  if r.quantity = 9 and r.original ->> 'quantity' = '8' and r.original -> 'degisti' is null then
    raise notice 'PASS E: düzeltme kaydedilir, ilk değer değiştirilemez';
  else
    raise exception 'TEST BAŞARISIZ: original değişti %', r.original;
  end if;
  select count(*) into v_n from public.quantity_item_history where item_id = v_i and action = 'guncelle' and changes ? 'quantity';
  if v_n = 1 then raise notice 'PASS E: düzeltme geçmişe yazıldı'; else raise exception 'TEST BAŞARISIZ: geçmiş %', v_n; end if;

  -- Belirsiz → onay: onaylayan/zaman sunucudan, belirsiz işareti kalkar
  update public.quantity_items set uncertain = true, review_note = 'Çizelge ve plan farklı' where id = v_i returning * into r;
  if r.uncertain and r.approved_by is null then raise notice 'PASS E: belirsiz işaretlenir'; else raise exception 'TEST BAŞARISIZ: belirsiz'; end if;
  update public.quantity_items set verification = 'onaylandi', approved_by = gen_random_uuid() where id = v_i returning * into r;
  if r.approved_by = v_owner and r.approved_at is not null and not r.uncertain then
    raise notice 'PASS E: onaylayan kullanıcı ve zaman sunucuda yazılır, belirsiz kalkar';
  else
    raise exception 'TEST BAŞARISIZ: onay bilgisi %', row_to_json(r);
  end if;
  -- Onay geri alınınca onay bilgisi temizlenir
  update public.quantity_items set verification = 'reddedildi' where id = v_i returning * into r;
  if r.approved_by is null and r.approved_at is null then raise notice 'PASS E: onay geri alınınca onay bilgisi silinir'; else raise exception 'TEST BAŞARISIZ: red'; end if;

  -- Analiz kaydı: dosya özeti biçimi; çelişki ve doğrulama bildirimleri
  begin
    insert into public.cad_analyses (project_id, file_name, file_kind, engine_version, file_hash) values (v_p, 'x.pdf', 'pdf', 't', 'abc');
    raise exception 'TEST BAŞARISIZ: geçersiz özet kabul edildi';
  exception when check_violation then raise notice 'PASS E: geçersiz dosya özeti reddedilir';
  end;
  insert into public.cad_analyses (project_id, file_name, file_kind, engine_version, candidate_count, summary, file_hash)
  values (v_p, 'proje.pdf', 'pdf', 'leonx-cad-1.1', 6, '{"tespit":{"aday":6,"celiski":1}}', repeat('a', 64)) returning id into v_a;
  if exists (select 1 from public.notifications where dedupe_key = 'cad:' || v_a || ':celiski' and kind = 'cad_celiski')
     and exists (select 1 from public.project_events where project_id = v_p and kind = 'cad_celiski') then
    raise notice 'PASS E: çelişki bildirimi ve zaman çizelgesi olayı';
  else
    raise exception 'TEST BAŞARISIZ: çelişki bildirimi yok';
  end if;
  if exists (select 1 from public.notifications where dedupe_key = 'cad:' || v_a || ':dogrulama' and kind = 'metraj_dogrulama')
     and exists (select 1 from public.notifications where dedupe_key = 'cad:' || v_a and kind = 'cad_tamam') then
    raise notice 'PASS E: "metraj doğrulama bekliyor" bildirimi; mevcut "analiz tamamlandı" korunur';
  else
    raise exception 'TEST BAŞARISIZ: doğrulama bildirimi yok';
  end if;
  -- Çelişkisiz analiz: çelişki bildirimi yok
  insert into public.cad_analyses (project_id, file_name, file_kind, engine_version, candidate_count, summary)
  values (v_p, 'temiz.pdf', 'pdf', 't', 2, '{"tespit":{"aday":2,"celiski":0}}') returning id into v_a;
  if not exists (select 1 from public.notifications where dedupe_key = 'cad:' || v_a || ':celiski') then
    raise notice 'PASS E: çelişki yoksa çelişki bildirimi üretilmez';
  else
    raise exception 'TEST BAŞARISIZ: gereksiz çelişki bildirimi';
  end if;

  -- CAD dosyası bildirimi
  insert into public.project_files (project_id, file_name, storage_path, size_bytes, mime_type)
  values (v_p, 'Kat Planı.pdf', v_p || '/f52-test/plan.pdf', 10, 'application/pdf');
  if exists (select 1 from public.notifications where kind = 'cad_dosya' and title like 'CAD / çizim dosyası yüklendi: Kat Planı.pdf') then
    raise notice 'PASS E: CAD dosyası yüklendi bildirimi';
  else
    raise exception 'TEST BAŞARISIZ: CAD dosyası bildirimi yok';
  end if;

  -- İstemci olayı: analiz başladı (geçerli tür); bilinmeyen tür reddedilir
  perform public.notify_client_event('cad_basladi', 'CAD analizi başladı: proje.pdf', '5 sayfa', '/cad-analiz', 'proje.pdf:1');
  raise notice 'PASS E: "CAD analizi başladı" istemci olayı kabul edilir';
  begin
    perform public.notify_client_event('rastgele', 'x', null, null, 'k');
    raise exception 'TEST BAŞARISIZ: geçersiz olay türü kabul edildi';
  exception when invalid_parameter_value then raise notice 'PASS E: geçersiz istemci olayı reddedilir';
  end;
end;
$$;

reset role;
do $$ begin raise notice 'TESTLER BAŞARILI (engineering)'; end; $$;
rollback;
