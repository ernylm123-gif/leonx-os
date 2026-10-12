-- =====================================================================
-- LEONX OS — 002: Row Level Security ve yetkiler
--
-- İlke: varsayılan erişim kapalı. Her iş tablosunda RLS açık ve tüm
-- işlemler yalnızca public.is_owner() doğru olduğunda izinli.
-- is_owner(), auth.uid() değerini app_owner tablosundaki tek UUID ile
-- karşılaştırır; e-posta adresine veya istemciden gelen alanlara dayanmaz.
--
-- Tekrar çalıştırılabilir: politikalar "drop if exists + create" ile
-- yeniden tanımlanır, veriye dokunulmaz.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tablo yetkileri: anon (giriş yapmamış) hiçbir tabloya erişemez.
-- ---------------------------------------------------------------------
revoke all on table
  public.app_owner, public.companies, public.contacts, public.projects,
  public.project_status_history, public.project_notes, public.project_files,
  public.activity_log
from anon;

revoke all on table
  public.app_owner, public.companies, public.contacts, public.projects,
  public.project_status_history, public.project_notes, public.project_files,
  public.activity_log
from authenticated;

-- Oturum açmış kullanıcıya tablo düzeyinde izin; satır düzeyinde RLS ayrıca uygulanır.
grant select, insert, update, delete on table
  public.companies, public.contacts, public.projects, public.project_notes, public.project_files
to authenticated;

-- Geçmiş ve günlük salt okunurdur (yalnızca tetikleyiciler yazar).
grant select on table public.project_status_history, public.activity_log to authenticated;

-- Sahip yapılandırması salt okunurdur; değişiklik yalnızca SQL Editor'dan yapılır.
grant select on table public.app_owner to authenticated;

-- ---------------------------------------------------------------------
-- RLS'yi etkinleştir
-- ---------------------------------------------------------------------
alter table public.app_owner              enable row level security;
alter table public.companies              enable row level security;
alter table public.contacts               enable row level security;
alter table public.projects               enable row level security;
alter table public.project_status_history enable row level security;
alter table public.project_notes          enable row level security;
alter table public.project_files          enable row level security;
alter table public.activity_log           enable row level security;

-- ---------------------------------------------------------------------
-- app_owner: sahip yalnızca kendi kaydını görebilir; yazma politikası yok.
-- ---------------------------------------------------------------------
drop policy if exists app_owner_select on public.app_owner;
create policy app_owner_select on public.app_owner
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- Okunur/yazılır iş tabloları: dört işlem için ayrı politika
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['companies', 'contacts', 'projects', 'project_notes', 'project_files'] loop
    execute format('drop policy if exists owner_select on public.%I', t);
    execute format('create policy owner_select on public.%I for select to authenticated using ((select public.is_owner()))', t);

    execute format('drop policy if exists owner_insert on public.%I', t);
    execute format('create policy owner_insert on public.%I for insert to authenticated with check ((select public.is_owner()))', t);

    execute format('drop policy if exists owner_update on public.%I', t);
    execute format('create policy owner_update on public.%I for update to authenticated using ((select public.is_owner())) with check ((select public.is_owner()))', t);

    execute format('drop policy if exists owner_delete on public.%I', t);
    execute format('create policy owner_delete on public.%I for delete to authenticated using ((select public.is_owner()))', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- Salt okunur tablolar: yalnızca SELECT politikası
-- ---------------------------------------------------------------------
drop policy if exists owner_select on public.project_status_history;
create policy owner_select on public.project_status_history
  for select to authenticated
  using ((select public.is_owner()));

drop policy if exists owner_select on public.activity_log;
create policy owner_select on public.activity_log
  for select to authenticated
  using ((select public.is_owner()));
