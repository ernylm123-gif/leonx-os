-- =====================================================================
-- LEONX OS — Tek yetkili kullanıcıyı (sahip) tanımlama
--
-- Migration'lar uygulandıktan ve Supabase panelinde kullanıcı hesabı
-- oluşturulduktan SONRA, Supabase SQL Editor'da bir kez çalıştırın.
--
-- 1) Authentication → Users sayfasında kendi hesabınızın "User UID"
--    değerini kopyalayın.
-- 2) Aşağıdaki 00000000-0000-0000-0000-000000000000 değerini bu UUID
--    ile değiştirin.
-- 3) Tüm dosyayı çalıştırın. Sonuç satırında e-posta adresiniz görünmelidir.
--
-- Tekrar çalıştırılırsa sahip güncellenir (tabloda tek satır vardır).
-- Veriler silinmez; yalnızca erişim yetkisi yeni UUID'ye geçer.
-- =====================================================================
do $$
declare
  v_owner uuid := '00000000-0000-0000-0000-000000000000';  -- ← BURAYA KENDİ USER UID DEĞERİNİZİ YAZIN
begin
  if v_owner = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Önce dosyadaki örnek UUID''yi kendi User UID değerinizle değiştirin.';
  end if;

  if not exists (select 1 from auth.users where id = v_owner) then
    raise exception 'Bu UUID ile bir kullanıcı bulunamadı: %. Authentication → Users sayfasını kontrol edin.', v_owner;
  end if;

  insert into public.app_owner (singleton, user_id)
  values (true, v_owner)
  on conflict (singleton) do update set user_id = excluded.user_id;
end;
$$;

-- Doğrulama: tanımlı sahip
select o.user_id, u.email, o.created_at
from public.app_owner o
join auth.users u on u.id = o.user_id;
