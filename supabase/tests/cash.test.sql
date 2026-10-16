-- =====================================================================
-- LEONX OS — 013: manuel gelir-gider, kasa ve banka
-- Tek işlem içinde çalışır ve sonunda ROLLBACK yapar; kalıcı veri bırakmaz.
-- =====================================================================
begin;

select set_config('leonx.owner', (select user_id::text from public.app_owner), true);
select set_config('leonx.intruder', gen_random_uuid()::text, true);

create or replace function pg_temp.act_as(p_user text)
returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- Hesap bakiyesi (görünümden)
create or replace function pg_temp.bal(p_account uuid)
returns numeric language sql as $$
  select balance from public.finance_account_balances where account_id = p_account;
$$;

-- =====================================================================
-- A) ANON ve KATALOG
-- =====================================================================
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
declare t text;
begin
  foreach t in array array['finance_accounts', 'finance_categories', 'finance_recurring', 'finance_entries', 'finance_transfers',
    'finance_documents', 'finance_audit_log', 'finance_ledger', 'finance_account_balances'] loop
    begin
      execute format('select count(*) from public.%I', t);
      raise exception 'TEST BAŞARISIZ: anon % okuyabildi', t;
    exception when insufficient_privilege then
      raise notice 'PASS A: anon % okuyamaz', t;
    end;
  end loop;
  begin
    perform public.leonx_finance_generate_recurring(null);
    raise exception 'TEST BAŞARISIZ: anon düzenli kayıt üretti';
  exception when insufficient_privilege then raise notice 'PASS A: anon düzenli kayıt üretim fonksiyonunu çağıramaz';
  end;
end;
$$;
reset role;

do $$
declare f text; t text; v_n int;
begin
  foreach f in array array['tg_fin_entry_guard', 'tg_fin_transfer_guard', 'tg_fin_no_delete', 'tg_fin_project_cash_guard',
    'tg_fin_recurring_guard', 'tg_fin_category_guard', 'tg_fin_account_guard', 'tg_fin_document_guard', 'tg_fin_audit'] loop
    if has_function_privilege('authenticated', format('public.%I()', f), 'execute')
       or has_function_privilege('anon', format('public.%I()', f), 'execute') then
      raise exception 'TEST BAŞARISIZ: % istemciye açık', f;
    end if;
  end loop;
  raise notice 'PASS A: kasa/banka tetikleyici fonksiyonları istemciye kapalı';
  foreach t in array array['finance_ledger', 'finance_account_balances'] loop
    if not exists (select 1 from pg_class where relname = t and 'security_invoker=true' = any (reloptions)) then
      raise exception 'TEST BAŞARISIZ: % security_invoker değil', t;
    end if;
  end loop;
  raise notice 'PASS A: defter ve bakiye görünümleri security_invoker (RLS geçerli)';
  foreach t in array array['finance_accounts', 'finance_categories', 'finance_recurring', 'finance_entries', 'finance_transfers',
    'finance_documents', 'finance_audit_log'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      raise exception 'TEST BAŞARISIZ: % RLS kapalı', t;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
      raise exception 'TEST BAŞARISIZ: % realtime yayınında değil', t;
    end if;
  end loop;
  raise notice 'PASS A: yeni tabloların hepsinde RLS açık ve realtime yayınında';
  if has_table_privilege('authenticated', 'public.finance_audit_log', 'insert')
     or has_table_privilege('authenticated', 'public.finance_audit_log', 'update')
     or has_table_privilege('authenticated', 'public.finance_audit_log', 'delete') then
    raise exception 'TEST BAŞARISIZ: değişiklik geçmişine istemci yazabilir';
  end if;
  raise notice 'PASS A: değişiklik geçmişi istemciye yalnız okunur';
  select count(*) into v_n from public.finance_categories where is_system;
  if v_n <> 15 then raise exception 'TEST BAŞARISIZ: sistem kategori sayısı %', v_n; end if;
  if (select count(*) from public.finance_categories where is_system and kind = 'gider') <> 10 then raise exception 'TEST BAŞARISIZ: gider kategorileri'; end if;
  raise notice 'PASS A: 10 gider + 5 gelir sistem kategorisi bir kez (migration iki kez uygulandı)';
  if not exists (select 1 from storage.buckets where id = 'finance-documents' and public = false and file_size_limit = 15728640) then
    raise exception 'TEST BAŞARISIZ: belge deposu';
  end if;
  raise notice 'PASS A: belge deposu özel, 15 MB sınırlı';
  if (select count(*) from public.companies where name = 'Mevcut veri — silinmemeli') <> 1 then
    raise exception 'TEST BAŞARISIZ: mevcut veri değişti';
  end if;
  raise notice 'PASS A: mevcut veri migration sonrası aynen duruyor';
end;
$$;

-- =====================================================================
-- B) SAHİP: hesaplar, genel kayıtlar, virman, bakiye
-- =====================================================================
set local role authenticated;
select pg_temp.act_as(current_setting('leonx.owner'));

do $$
declare
  v_kasa uuid; v_banka uuid; v_eur uuid; v_inc uuid; v_exp uuid; v_cat_gelir uuid; v_cat_gider uuid;
  v_e1 uuid; v_e2 uuid; v_e3 uuid; v_t1 uuid; v_t2 uuid; v_acc public.finance_accounts; v_num numeric; v_n int;
begin
  insert into public.finance_accounts (name, kind, currency, opening_balance) values ('Merkez kasa', 'kasa', 'TRY', 1000) returning id into v_kasa;
  insert into public.finance_accounts (name, kind, currency, bank_name, iban) values ('İş Bankası TL', 'banka', 'TRY', 'İş Bankası', 'tr33 0006 1005 1978 6457 8413 26') returning * into v_acc;
  v_banka := v_acc.id;
  if v_acc.iban <> 'TR330006100519786457841326' then raise exception 'TEST BAŞARISIZ: IBAN normalize edilmedi %', v_acc.iban; end if;
  insert into public.finance_accounts (name, kind, currency) values ('Euro hesap', 'banka', 'EUR') returning id into v_eur;
  perform set_config('leonx.kasa', v_kasa::text, true);
  perform set_config('leonx.banka', v_banka::text, true);
  perform set_config('leonx.eur', v_eur::text, true);
  raise notice 'PASS B: kasa ve banka hesapları; IBAN boşluksuz büyük harfe çevrilir';
  begin
    insert into public.finance_accounts (name, kind, iban) values ('Bozuk IBAN', 'banka', 'TR12');
    raise exception 'TEST BAŞARISIZ: geçersiz IBAN kabul edildi';
  exception when check_violation then raise notice 'PASS B: geçersiz IBAN reddedilir';
  end;
  begin
    insert into public.finance_accounts (name) values ('merkez KASA ');
    raise exception 'TEST BAŞARISIZ: aynı adlı hesap';
  exception when unique_violation then raise notice 'PASS B: hesap adı benzersiz';
  end;
  if pg_temp.bal(v_kasa) <> 1000 or pg_temp.bal(v_banka) <> 0 then raise exception 'TEST BAŞARISIZ: açılış bakiyesi'; end if;
  raise notice 'PASS B: hareketsiz hesap bakiyesi = açılış bakiyesi';

  select id into v_cat_gelir from public.finance_categories where kind = 'gelir' and key = 'hizmet';
  select id into v_cat_gider from public.finance_categories where kind = 'gider' and key = 'kira';
  perform set_config('leonx.cat_gelir', v_cat_gelir::text, true);
  perform set_config('leonx.cat_gider', v_cat_gider::text, true);

  -- Genel gelir 500 + KDV 100 → kasa +600; genel gider 200 + KDV 40 → kasa −240
  insert into public.finance_entries (kind, entry_date, amount, vat_amount, currency, category_id, account_id, description, payment_method)
  values ('gelir', current_date, 500, 100, 'TRY', v_cat_gelir, v_kasa, 'Servis bedeli', 'nakit') returning id into v_e1;
  insert into public.finance_entries (kind, entry_date, amount, vat_amount, currency, category_id, account_id, description)
  values ('gider', current_date, 200, 40, 'TRY', v_cat_gider, v_kasa, 'Atölye kirası') returning id into v_e2;
  if pg_temp.bal(v_kasa) <> 1360 then raise exception 'TEST BAŞARISIZ: kasa bakiyesi % (1360 beklenir)', pg_temp.bal(v_kasa); end if;
  raise notice 'PASS B: gerçekleşen gelir/gider bakiyeyi KDV dahil tutarla değiştirir (1000 + 600 − 240 = 1360)';
  perform set_config('leonx.e1', v_e1::text, true);
  perform set_config('leonx.e2', v_e2::text, true);

  -- Kuruş hassasiyeti: 0,10 + 0,20 = 0,30 ve 3 × 33,33 = 99,99
  insert into public.finance_entries (kind, entry_date, amount, currency, category_id, account_id, description) values
    ('gelir', current_date, 0.1, 'TRY', v_cat_gelir, v_banka, 'h1'), ('gelir', current_date, 0.2, 'TRY', v_cat_gelir, v_banka, 'h2');
  if pg_temp.bal(v_banka) <> 0.30 then raise exception 'TEST BAŞARISIZ: 0,1 + 0,2 = %', pg_temp.bal(v_banka); end if;
  insert into public.finance_entries (kind, entry_date, amount, currency, category_id, account_id, description) values
    ('gider', current_date, 33.33, 'TRY', v_cat_gider, v_banka, 'p1'), ('gider', current_date, 33.33, 'TRY', v_cat_gider, v_banka, 'p2'),
    ('gider', current_date, 33.33, 'TRY', v_cat_gider, v_banka, 'p3');
  if pg_temp.bal(v_banka) <> -99.69 then raise exception 'TEST BAŞARISIZ: 0,30 − 3 × 33,33 = %', pg_temp.bal(v_banka); end if;
  insert into public.finance_entries (kind, entry_date, amount, currency, category_id, account_id, description)
  values ('gelir', current_date, 99.69, 'TRY', v_cat_gelir, v_banka, 'denge');
  if pg_temp.bal(v_banka) <> 0 then raise exception 'TEST BAŞARISIZ: denge'; end if;
  raise notice 'PASS B: numeric(14,2) kuruş hassasiyeti (0,1 + 0,2 = 0,30; 3 × 33,33 = 99,99)';

  -- Bekleyen gider (hesapsız) bakiyeyi etkilemez; gerçekleşen kayıt hesapsız olamaz
  insert into public.finance_entries (kind, entry_date, amount, currency, category_id, status, due_date, description)
  values ('gider', current_date, 5000, 'TRY', v_cat_gider, 'bekliyor', current_date + 10, 'Gelecek ay kirası') returning id into v_e3;
  if pg_temp.bal(v_kasa) <> 1360 then raise exception 'TEST BAŞARISIZ: bekleyen gider bakiyeyi değiştirdi'; end if;
  if exists (select 1 from public.finance_ledger where source_id = v_e3) then raise exception 'TEST BAŞARISIZ: bekleyen kayıt defterde'; end if;
  raise notice 'PASS B: "bekliyor" kayıt defterde ve bakiyede yok';
  begin
    insert into public.finance_entries (kind, entry_date, amount, currency, category_id, description) values ('gider', current_date, 1, 'TRY', v_cat_gider, 'Hesapsız');
    raise exception 'TEST BAŞARISIZ: gerçekleşen kayıt hesapsız';
  exception when check_violation then raise notice 'PASS B: gerçekleşen genel kayıt bir hesaba yazılmalı';
  end;
  begin
    insert into public.finance_entries (kind, entry_date, amount, currency, category_id, account_id, description) values ('gelir', current_date, 1, 'TRY', v_cat_gider, v_kasa, 'Yanlış kategori');
    raise exception 'TEST BAŞARISIZ: gelir kaydına gider kategorisi';
  exception when check_violation then raise notice 'PASS B: kategori türü uyuşmazlığı reddedilir';
  end;
  begin
    insert into public.finance_entries (kind, entry_date, amount, currency, category_id, account_id, description) values ('gelir', current_date, 1, 'EUR', v_cat_gelir, v_kasa, 'Yanlış para birimi');
    raise exception 'TEST BAŞARISIZ: TRY hesaba EUR kayıt';
  exception when check_violation then raise notice 'PASS B: hesap ve kayıt para birimi uyuşmazlığı reddedilir';
  end;
  begin
    insert into public.finance_entries (kind, entry_date, amount, currency, category_id, account_id, description) values ('gelir', current_date, 0, 'TRY', v_cat_gelir, v_kasa, 'Sıfır');
    raise exception 'TEST BAŞARISIZ: sıfır tutar';
  exception when check_violation then raise notice 'PASS B: tutar sıfırdan büyük olmalı';
  end;

  -- Virman: kasa → banka 300; gelir/gider toplamları değişmez
  select coalesce(sum(amount) filter (where kind = 'gelir'), 0) - coalesce(sum(amount) filter (where kind = 'gider'), 0) into v_num from public.finance_ledger;
  insert into public.finance_transfers (transfer_date, from_account_id, to_account_id, from_amount, to_amount, description)
  values (current_date, v_kasa, v_banka, 300, 300, 'Bankaya yatırıldı') returning id into v_t1;
  perform set_config('leonx.t1', v_t1::text, true);
  if pg_temp.bal(v_kasa) <> 1060 or pg_temp.bal(v_banka) <> 300 then raise exception 'TEST BAŞARISIZ: virman bakiyeleri % %', pg_temp.bal(v_kasa), pg_temp.bal(v_banka); end if;
  if v_num <> (select coalesce(sum(amount) filter (where kind = 'gelir'), 0) - coalesce(sum(amount) filter (where kind = 'gider'), 0) from public.finance_ledger) then
    raise exception 'TEST BAŞARISIZ: virman gelir/gider toplamını değiştirdi';
  end if;
  if (select count(*) from public.finance_ledger where source_id = v_t1 and kind = 'transfer') <> 2 then raise exception 'TEST BAŞARISIZ: virman defter satırları'; end if;
  raise notice 'PASS B: virman bakiyeleri taşır (kasa −300, banka +300); gelir/gider değildir (defterde tür "transfer")';
  begin
    insert into public.finance_transfers (transfer_date, from_account_id, to_account_id, from_amount, to_amount) values (current_date, v_kasa, v_banka, 300, 299);
    raise exception 'TEST BAŞARISIZ: aynı birimde farklı tutar';
  exception when check_violation then raise notice 'PASS B: aynı para biriminde çıkan = giren tutar';
  end;
  begin
    insert into public.finance_transfers (transfer_date, from_account_id, to_account_id, from_amount, to_amount) values (current_date, v_kasa, v_kasa, 1, 1);
    raise exception 'TEST BAŞARISIZ: aynı hesaba virman';
  exception when check_violation then null;
  end;
  insert into public.finance_transfers (transfer_date, from_account_id, to_account_id, from_amount, to_amount, description)
  values (current_date, v_banka, v_eur, 100, 2.5, 'Döviz alımı') returning id into v_t2;
  if pg_temp.bal(v_banka) <> 200 or pg_temp.bal(v_eur) <> 2.5 then raise exception 'TEST BAŞARISIZ: dövizli virman'; end if;
  raise notice 'PASS B: farklı para birimleri arasında virman elle girilen iki tutarla';

  -- Silme engeli
  begin
    delete from public.finance_entries where id = v_e1;
    raise exception 'TEST BAŞARISIZ: genel kayıt silindi';
  exception when check_violation then
    if sqlerrm <> 'Kayıt silinemez; iptal edin' then raise exception 'TEST BAŞARISIZ: ileti %', sqlerrm; end if;
    raise notice 'PASS B: genel kayıt silinemez ("Kayıt silinemez; iptal edin")';
  end;
  begin
    delete from public.finance_transfers where id = v_t1;
    raise exception 'TEST BAŞARISIZ: virman silindi';
  exception when check_violation then raise notice 'PASS B: virman silinemez';
  end;

  -- İptal: sebep zorunlu; bakiye geri döner; iptal edilen kayıt değiştirilemez
  begin
    update public.finance_entries set voided_at = now() where id = v_e2;
    raise exception 'TEST BAŞARISIZ: sebepsiz iptal';
  exception when check_violation then raise notice 'PASS B: iptal sebebi zorunlu';
  end;
  begin
    update public.finance_entries set voided_at = now(), voided_reason = 'x', amount = 1 where id = v_e2;
    raise exception 'TEST BAŞARISIZ: iptalle birlikte tutar değişti';
  exception when check_violation then null;
  end;
  update public.finance_entries set voided_at = now() - interval '3 days', voided_reason = 'Yanlış girildi' where id = v_e2;
  if pg_temp.bal(v_kasa) <> 1300 then raise exception 'TEST BAŞARISIZ: iptal sonrası kasa %', pg_temp.bal(v_kasa); end if;
  if (select voided_by::text from public.finance_entries where id = v_e2) <> current_setting('leonx.owner')
     or (select voided_at from public.finance_entries where id = v_e2) < now() - interval '1 minute' then
    raise exception 'TEST BAŞARISIZ: iptal eden/zaman sunucuda yazılmadı';
  end if;
  if not exists (select 1 from public.finance_entries where id = v_e2) then raise exception 'TEST BAŞARISIZ: iptal edilen kayıt kayboldu'; end if;
  raise notice 'PASS B: iptal edilen gider bakiyeden çıkar (1060 + 240 = 1300), kayıt saklanır; iptal zamanı ve kullanıcı sunucuda';
  begin
    update public.finance_entries set description = 'Değişti' where id = v_e2;
    raise exception 'TEST BAŞARISIZ: iptal edilmiş kayıt değişti';
  exception when check_violation then raise notice 'PASS B: iptal edilmiş kayıt değiştirilemez';
  end;
  update public.finance_transfers set voided_at = now(), voided_reason = 'Yanlış hesap' where id = v_t1;
  if pg_temp.bal(v_kasa) <> 1600 or pg_temp.bal(v_banka) <> -100 then raise exception 'TEST BAŞARISIZ: virman iptali % %', pg_temp.bal(v_kasa), pg_temp.bal(v_banka); end if;
  raise notice 'PASS B: iptal edilen virman iki hesabı da eski hâline getirir';

  -- Değişiklik geçmişi
  update public.finance_entries set description = 'Servis bedeli (düzeltildi)' where id = v_e1;
  if (select count(*) from public.finance_audit_log where table_name = 'finance_entries' and row_id = v_e1 and action = 'insert') <> 1
     or (select count(*) from public.finance_audit_log where table_name = 'finance_entries' and row_id = v_e1 and action = 'update') <> 1
     or (select count(*) from public.finance_audit_log where table_name = 'finance_entries' and row_id = v_e2 and action = 'void') <> 1
     or (select count(*) from public.finance_audit_log where table_name = 'finance_transfers' and row_id = v_t1 and action = 'void') <> 1 then
    raise exception 'TEST BAŞARISIZ: geçmiş satırları';
  end if;
  if (select old_row ->> 'description' from public.finance_audit_log where row_id = v_e1 and action = 'update') <> 'Servis bedeli'
     or (select changed_by::text from public.finance_audit_log where row_id = v_e1 and action = 'update') <> current_setting('leonx.owner') then
    raise exception 'TEST BAŞARISIZ: geçmiş eski değer / kullanıcı';
  end if;
  raise notice 'PASS B: değişiklik geçmişi ekleme, güncelleme (eski/yeni değer) ve iptal satırları yazar';
  begin
    insert into public.finance_audit_log (table_name, action) values ('x', 'insert');
    raise exception 'TEST BAŞARISIZ: istemci geçmişe yazdı';
  exception when insufficient_privilege then raise notice 'PASS B: istemci değişiklik geçmişine yazamaz';
  end;
  begin
    delete from public.finance_audit_log;
    raise exception 'TEST BAŞARISIZ: istemci geçmişi sildi';
  exception when insufficient_privilege then null;
  end;

  -- Hareketi olan hesap silinemez, para birimi değişmez; pasif hesaba yeni hareket yazılmaz
  begin
    delete from public.finance_accounts where id = v_kasa;
    raise exception 'TEST BAŞARISIZ: hareketli hesap silindi';
  exception when foreign_key_violation then raise notice 'PASS B: hareketi olan hesap silinemez (yalnız pasifleştirilir)';
  end;
  begin
    update public.finance_accounts set currency = 'USD' where id = v_kasa;
    raise exception 'TEST BAŞARISIZ: hareketli hesabın para birimi değişti';
  exception when check_violation then null;
  end;
  update public.finance_accounts set active = false where id = v_eur;
  begin
    insert into public.finance_entries (kind, entry_date, amount, currency, category_id, account_id, description) values ('gelir', current_date, 1, 'EUR', v_cat_gelir, v_eur, 'Pasif');
    raise exception 'TEST BAŞARISIZ: pasif hesaba hareket';
  exception when check_violation then raise notice 'PASS B: pasif hesaba yeni hareket yazılamaz; bakiyesi korunur';
  end;
  if pg_temp.bal(v_eur) <> 2.5 then raise exception 'TEST BAŞARISIZ: pasif hesap bakiyesi'; end if;
  update public.finance_accounts set active = true where id = v_eur;

  -- Kategoriler
  begin
    delete from public.finance_categories where id = v_cat_gider;
    raise exception 'TEST BAŞARISIZ: sistem kategorisi silindi';
  exception when check_violation then raise notice 'PASS B: sistem kategorisi silinemez';
  end;
  begin
    update public.finance_categories set name = 'Elektrik' where id = v_cat_gider;
    raise exception 'TEST BAŞARISIZ: kategori adı çakıştı';
  exception when unique_violation then raise notice 'PASS B: kategori adı tür içinde benzersiz';
  end;
  begin
    update public.finance_categories set kind = 'gelir' where id = v_cat_gider;
    raise exception 'TEST BAŞARISIZ: sistem kategori türü değişti';
  exception when check_violation then null;
  end;
  update public.finance_categories set active = false where id = (select id from public.finance_categories where key = 'yemek');
  insert into public.finance_categories (kind, key, name, is_system) values ('gider', 'sahte', 'Sigorta', true);
  if (select is_system or key is not null from public.finance_categories where name = 'Sigorta') then raise exception 'TEST BAŞARISIZ: istemci sistem kategorisi oluşturdu'; end if;
  delete from public.finance_categories where name = 'Sigorta';
  raise notice 'PASS B: sistem kategorisi pasifleştirilebilir; kullanıcı kategorisi eklenir/silinir, sistem kategorisi oluşturamaz';
end;
$$;

-- Proje tahsilatı ve gideri: mevcut tablolar, çift kayıt yok
do $$
declare
  v_kasa uuid := current_setting('leonx.kasa')::uuid;
  v_banka uuid := current_setting('leonx.banka')::uuid;
  v_cat_gelir uuid := current_setting('leonx.cat_gelir')::uuid;
  v_cat_gider uuid := current_setting('leonx.cat_gider')::uuid;
  v_c uuid; v_p uuid; v_x uuid; v_col uuid; v_b0 numeric; v_n int;
begin
  insert into public.companies (name) values ('Kasa Test Firma') returning id into v_c;
  insert into public.projects (code, name, category, company_id, stage) values ('LX-KB-1', 'Kasa projesi', 'aluminyum_dograma', v_c, 'uretimde') returning id into v_p;
  v_b0 := pg_temp.bal(v_banka);
  -- Ödeme planı (alacak) bakiyeyi etkilemez
  insert into public.project_payment_schedule (project_id, kind, due_date, amount, currency) values (v_p, 'pesinat', current_date + 5, 5000, 'TRY');
  if pg_temp.bal(v_banka) <> v_b0 then raise exception 'TEST BAŞARISIZ: alacak bakiyeyi değiştirdi'; end if;
  raise notice 'PASS C: alacak (ödeme planı) bakiyeyi etkilemez';
  insert into public.project_collections (project_id, received_date, amount, currency, method, account_id, category_id)
  values (v_p, current_date, 1000, 'TRY', 'havale', v_banka, v_cat_gelir) returning id into v_col;
  if pg_temp.bal(v_banka) <> v_b0 + 1000 then raise exception 'TEST BAŞARISIZ: tahsilat bakiyesi'; end if;
  if (select count(*) from public.finance_ledger where source_id = v_col and source = 'proje_tahsilat' and project_id = v_p and company_id = v_c) <> 1 then
    raise exception 'TEST BAŞARISIZ: tahsilat defterde';
  end if;
  if (select outstanding from public.project_receivables where project_id = v_p) <> 4000 then raise exception 'TEST BAŞARISIZ: alacak takibi bozuldu'; end if;
  raise notice 'PASS C: proje tahsilatı project_collections satırıdır; hesaba girer, alacak takibi aynen çalışır';
  begin
    insert into public.project_collections (project_id, received_date, amount, currency, account_id, category_id) values (v_p, current_date, 1, 'TRY', v_banka, v_cat_gider);
    raise exception 'TEST BAŞARISIZ: tahsilata gider kategorisi';
  exception when check_violation then null;
  end;
  begin
    insert into public.project_collections (project_id, received_date, amount, currency, account_id) values (v_p, current_date, 1, 'EUR', v_banka);
    raise exception 'TEST BAŞARISIZ: TRY hesaba EUR tahsilat';
  exception when check_violation then raise notice 'PASS C: tahsilatta hesap para birimi ve kategori türü denetlenir';
  end;
  -- Ödenmemiş gider hesaba yazılamaz ve bakiyeyi etkilemez
  begin
    insert into public.project_expenses (project_id, expense_date, cost_group, description, amount, currency, paid, account_id)
    values (v_p, current_date, 'montaj', 'Ödenmemiş ama hesaplı', 100, 'TRY', false, v_kasa);
    raise exception 'TEST BAŞARISIZ: ödenmemiş gider hesaba yazıldı';
  exception when check_violation then raise notice 'PASS C: ödenmemiş gider hesaba bağlanamaz';
  end;
  insert into public.project_expenses (project_id, expense_date, cost_group, description, amount, vat_amount, currency, paid)
  values (v_p, current_date, 'montaj', 'Montaj ekibi', 2000, 400, 'TRY', false) returning id into v_x;
  if pg_temp.bal(v_kasa) <> 1600 or exists (select 1 from public.finance_ledger where source_id = v_x) then raise exception 'TEST BAŞARISIZ: ödenmemiş gider bakiyede'; end if;
  raise notice 'PASS C: ödenmemiş proje gideri defterde ve bakiyede yok';
  update public.project_expenses set paid = true, account_id = v_kasa, category_id = v_cat_gider, payment_method = 'nakit' where id = v_x;
  if pg_temp.bal(v_kasa) <> 1600 - 2400 then raise exception 'TEST BAŞARISIZ: ödenen gider bakiyesi %', pg_temp.bal(v_kasa); end if;
  raise notice 'PASS C: ödenen proje gideri hesaptan KDV dahil düşer (1600 − 2400 = −800)';
  -- Hesapsız eski gider defterde "hesapsız" görünür, hiçbir hesabı etkilemez
  insert into public.project_expenses (project_id, expense_date, cost_group, description, amount, currency, paid)
  values (v_p, current_date, 'nakliye', 'Eski tip gider', 50, 'TRY', true);
  if (select count(*) from public.finance_ledger where source = 'proje_gider' and account_id is null and description = 'Eski tip gider') <> 1 then
    raise exception 'TEST BAŞARISIZ: hesapsız gider defterde';
  end if;
  if pg_temp.bal(v_kasa) <> -800 then raise exception 'TEST BAŞARISIZ: hesapsız gider bakiyeyi etkiledi'; end if;
  raise notice 'PASS C: hesapsız ödenmiş gider defterde hesapsız görünür, hiçbir bakiyeyi etkilemez';
  begin
    update public.project_expenses set paid = false where id = v_x;
    raise exception 'TEST BAŞARISIZ: hesaplı gider ödenmemiş yapıldı';
  exception when check_violation then null;
  end;
  update public.project_expenses set amount = 2100 where id = v_x;
  select count(*) into v_n from public.finance_audit_log where table_name = 'project_expenses' and row_id = v_x;
  if v_n <> 3 or (select (old_row ->> 'amount')::numeric from public.finance_audit_log where table_name = 'project_expenses' and row_id = v_x order by id desc limit 1) <> 2000 then
    raise exception 'TEST BAŞARISIZ: proje gideri geçmişi %', v_n;
  end if;
  delete from public.project_collections where id = v_col;
  if (select count(*) from public.finance_audit_log where table_name = 'project_collections' and row_id = v_col and action = 'delete') <> 1 then
    raise exception 'TEST BAŞARISIZ: tahsilat silme geçmişi';
  end if;
  raise notice 'PASS C: mevcut proje gideri/tahsilatı düzenleme ve silmesi geçmişe yazılır';
  -- Belge eki
  begin
    insert into public.finance_documents (entry_table, entry_id, storage_path, file_name, mime_type, size_bytes)
    values ('project_expenses', gen_random_uuid(), 'project_expenses/' || gen_random_uuid() || '/a.pdf', 'a.pdf', 'application/pdf', 10);
    raise exception 'TEST BAŞARISIZ: olmayan kayda belge';
  exception when check_violation then null;
  end;
  insert into public.finance_documents (entry_table, entry_id, storage_path, file_name, mime_type, size_bytes)
  values ('project_expenses', v_x, 'project_expenses/' || v_x || '/fis.jpg', 'fis.jpg', 'image/jpeg', 1024);
  begin
    insert into public.finance_documents (entry_table, entry_id, storage_path, file_name, mime_type, size_bytes)
    values ('project_expenses', v_x, 'project_expenses/' || v_x || '/b.exe', 'b.exe', 'application/x-msdownload', 10);
    raise exception 'TEST BAŞARISIZ: izinsiz dosya türü';
  exception when check_violation then null;
  end;
  begin
    insert into public.finance_documents (entry_table, entry_id, storage_path, file_name, mime_type, size_bytes)
    values ('project_expenses', v_x, 'project_expenses/' || v_x || '/c.pdf', 'c.pdf', 'application/pdf', 15728641);
    raise exception 'TEST BAŞARISIZ: 15 MB üstü belge';
  exception when check_violation then null;
  end;
  if (select created_by::text from public.finance_documents where entry_id = v_x) <> current_setting('leonx.owner') then raise exception 'TEST BAŞARISIZ: belge sahibi'; end if;
  raise notice 'PASS C: belge eki yalnız mevcut kayda, izinli türde (pdf/jpeg/png/webp/heic) ve en fazla 15 MB';
end;
$$;

-- Düzenli kayıtlar: idempotent üretim, ay sonu kaymaz, bakiyeye girmez
do $$
declare
  v_kasa uuid := current_setting('leonx.kasa')::uuid;
  v_cat_gider uuid := current_setting('leonx.cat_gider')::uuid;
  v_r uuid; v_r2 uuid; v_first int; v_second int; v_b0 numeric; v_dates date[];
begin
  v_b0 := pg_temp.bal(v_kasa);
  insert into public.finance_recurring (kind, description, amount, vat_amount, currency, category_id, account_id, frequency, start_date, end_date)
  values ('gider', 'Atölye kirası (aylık)', 10000, 2000, 'TRY', v_cat_gider, v_kasa, 'aylik', date '2026-01-31', date '2026-12-31') returning id into v_r;
  if (select next_date from public.finance_recurring where id = v_r) <> date '2026-01-31' then raise exception 'TEST BAŞARISIZ: sıradaki tarih'; end if;
  v_first := public.leonx_finance_generate_recurring(date '2026-04-30');
  v_second := public.leonx_finance_generate_recurring(date '2026-04-30');
  select array_agg(occurrence_date order by occurrence_date) into v_dates from public.finance_entries where recurring_id = v_r;
  if v_first <> 4 or v_second <> 0 or v_dates <> array[date '2026-01-31', date '2026-02-28', date '2026-03-31', date '2026-04-30'] then
    raise exception 'TEST BAŞARISIZ: düzenli üretim % % %', v_first, v_second, v_dates;
  end if;
  if (select next_date from public.finance_recurring where id = v_r) <> date '2026-05-31' then raise exception 'TEST BAŞARISIZ: sıradaki tarih ilerlemedi'; end if;
  if exists (select 1 from public.finance_entries where recurring_id = v_r and (status <> 'bekliyor' or due_date <> occurrence_date or amount <> 10000)) then
    raise exception 'TEST BAŞARISIZ: üretilen kayıt alanları';
  end if;
  if pg_temp.bal(v_kasa) <> v_b0 then raise exception 'TEST BAŞARISIZ: üretilen kayıt bakiyeyi etkiledi'; end if;
  raise notice 'PASS D: aylık şablon 31 Oca → 28 Şub → 31 Mar → 30 Nis; ikinci çağrı 0 yeni kayıt; "bekliyor", bakiyeye girmez';
  -- Sıradaki tarih elle geri alınsa bile benzersiz indeks çift kaydı engeller
  update public.finance_recurring set next_date = date '2026-01-31' where id = v_r;
  if public.leonx_finance_generate_recurring(date '2026-05-31') <> 1 then raise exception 'TEST BAŞARISIZ: geri sarma sonrası çift kayıt'; end if;
  raise notice 'PASS D: tarih başına tek kayıt (benzersiz indeks) — tekrar üretim çift kayıt oluşturmaz';
  insert into public.finance_recurring (kind, description, amount, currency, category_id, frequency, start_date, end_date)
  values ('gider', 'Haftalık yemek', 700, 'TRY', v_cat_gider, 'haftalik', date '2026-03-02', date '2026-03-20') returning id into v_r2;
  perform public.leonx_finance_generate_recurring(date '2026-04-30');
  if (select count(*) from public.finance_entries where recurring_id = v_r2) <> 3 then raise exception 'TEST BAŞARISIZ: haftalık bitiş tarihi'; end if;
  raise notice 'PASS D: haftalık şablon bitiş tarihinde durur (3 kayıt)';
  -- Gerçekleşti işaretlemek için hesap gerekir; sonra bakiyeye girer
  update public.finance_entries set status = 'gerceklesti' where recurring_id = v_r and occurrence_date = date '2026-01-31';
  if pg_temp.bal(v_kasa) <> v_b0 - 12000 then raise exception 'TEST BAŞARISIZ: ödenen düzenli kayıt'; end if;
  begin
    update public.finance_entries set status = 'gerceklesti' where recurring_id = v_r2;
    raise exception 'TEST BAŞARISIZ: hesapsız düzenli kayıt gerçekleşti';
  exception when check_violation then null;
  end;
  raise notice 'PASS D: düzenli kayıt "gerçekleşti" yapılınca bakiyeye girer; hesapsız gerçekleşemez';
end;
$$;
reset role;

-- =====================================================================
-- F) MEVCUT VERİ: migration dolu veritabanında yeniden uygulanınca hiçbir satır değişmez
-- =====================================================================
create temp table cash_snapshot as
  select 'project_expenses' as t, to_jsonb(x) as j from public.project_expenses x
  union all select 'project_collections', to_jsonb(x) from public.project_collections x
  union all select 'finance_entries', to_jsonb(x) from public.finance_entries x
  union all select 'finance_transfers', to_jsonb(x) from public.finance_transfers x
  union all select 'finance_accounts', to_jsonb(x) from public.finance_accounts x
  union all select 'finance_categories', to_jsonb(x) from public.finance_categories x
  union all select 'finance_recurring', to_jsonb(x) from public.finance_recurring x;
select set_config('leonx.audit_before', (select count(*)::text from public.finance_audit_log), true);
\ir ../migrations/20261016001300_leonx_cash.sql
do $$
declare v_missing int; v_now int;
begin
  select count(*) into v_missing from cash_snapshot s where not exists (
    select 1 from (
      select to_jsonb(x) as j from public.project_expenses x
      union all select to_jsonb(x) from public.project_collections x
      union all select to_jsonb(x) from public.finance_entries x
      union all select to_jsonb(x) from public.finance_transfers x
      union all select to_jsonb(x) from public.finance_accounts x
      union all select to_jsonb(x) from public.finance_categories x
      union all select to_jsonb(x) from public.finance_recurring x) c where c.j = s.j);
  select (select count(*) from public.project_expenses) + (select count(*) from public.project_collections) + (select count(*) from public.finance_entries)
       + (select count(*) from public.finance_transfers) + (select count(*) from public.finance_accounts) + (select count(*) from public.finance_categories)
       + (select count(*) from public.finance_recurring) into v_now;
  if v_missing <> 0 or v_now <> (select count(*) from cash_snapshot) then
    raise exception 'TEST BAŞARISIZ: migration yeniden uygulanınca % satır değişti (satır sayısı % → %)', v_missing, (select count(*) from cash_snapshot), v_now;
  end if;
  if (select count(*) from public.finance_audit_log)::text <> current_setting('leonx.audit_before') then
    raise exception 'TEST BAŞARISIZ: migration geçmiş satırı üretti';
  end if;
  raise notice 'PASS F: dolu veritabanında migration yeniden uygulandı; % satırın hiçbiri değişmedi, geçmiş satırı üretilmedi', v_now;
end;
$$;

-- =====================================================================
-- E) YETKİSİZ HESAP
-- =====================================================================
set local role authenticated;
select pg_temp.act_as(current_setting('leonx.intruder'));
do $$
declare t text; v_n int;
begin
  foreach t in array array['finance_accounts', 'finance_categories', 'finance_recurring', 'finance_entries', 'finance_transfers',
    'finance_documents', 'finance_audit_log', 'finance_ledger', 'finance_account_balances'] loop
    execute format('select count(*) from public.%I', t) into v_n;
    if v_n <> 0 then raise exception 'TEST BAŞARISIZ: yetkisiz hesap % içinde % satır gördü', t, v_n; end if;
  end loop;
  raise notice 'PASS E: yetkisiz hesap hiçbir kasa/banka verisini (görünümler ve geçmiş dahil) göremez';
  begin
    insert into public.finance_accounts (name) values ('Sızma kasası');
    raise exception 'TEST BAŞARISIZ: yetkisiz hesap hesap açtı';
  exception when insufficient_privilege then raise notice 'PASS E: yetkisiz hesap hesap açamaz';
  end;
  begin
    insert into public.finance_categories (kind, name) values ('gider', 'Sızma');
    raise exception 'TEST BAŞARISIZ: yetkisiz hesap kategori ekledi';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.leonx_finance_generate_recurring(null);
    raise exception 'TEST BAŞARISIZ: yetkisiz hesap düzenli kayıt üretti';
  exception when insufficient_privilege then raise notice 'PASS E: yetkisiz hesap düzenli kayıt üretemez';
  end;
  update public.finance_entries set description = 'x';
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'TEST BAŞARISIZ: yetkisiz hesap kayıt değiştirdi'; end if;
  update public.finance_accounts set opening_balance = 999;
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'TEST BAŞARISIZ: yetkisiz hesap bakiye değiştirdi'; end if;
  raise notice 'PASS E: yetkisiz hesap kayıt ve açılış bakiyesi değiştiremez';
end;
$$;
reset role;

do $$ begin raise notice 'TESTLER BAŞARILI (cash)'; end $$;
rollback;
