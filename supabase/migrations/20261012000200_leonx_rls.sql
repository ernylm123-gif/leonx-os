-- =====================================================================
-- LEONX OS — 002: Row Level Security ve yetkiler
--
-- İlke: varsayılan erişim kapalı. Her iş tablosunda RLS açık ve tüm
-- işlemler yalnızca public.is_owner() doğru olduğunda izinli.
-- is_owner(), auth.uid() değerini app_owner tablosundaki tek UUID ile
-- karşılaştırır; e-posta adresine veya istemciden gelen alanlara dayanmaz.
--
-- Tekrar çalıştırılabilir: politikalar yoksa oluşturulur, varsa
-- ALTER POLICY ile güncellenir. Hiçbir nesne silinmez, veriye dokunulmaz.
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

-- Politika tanımlama yardımcısı: politika yoksa oluşturur, varsa ALTER POLICY ile
-- günceller. Silme yapılmaz; tekrar çalıştırmak güvenlidir.
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

-- ---------------------------------------------------------------------
-- app_owner: sahip yalnızca kendi kaydını görebilir; yazma politikası yok.
-- ---------------------------------------------------------------------
select pg_temp.leonx_policy('public', 'app_owner', 'app_owner_select', 'select', 'user_id = (select auth.uid())', null);

-- ---------------------------------------------------------------------
-- Okunur/yazılır iş tabloları: dört işlem için ayrı politika
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['companies', 'contacts', 'projects', 'project_notes', 'project_files'] loop
    perform pg_temp.leonx_policy('public', t, 'owner_select', 'select', '(select public.is_owner())', null);
    perform pg_temp.leonx_policy('public', t, 'owner_insert', 'insert', null, '(select public.is_owner())');
    perform pg_temp.leonx_policy('public', t, 'owner_update', 'update', '(select public.is_owner())', '(select public.is_owner())');
    perform pg_temp.leonx_policy('public', t, 'owner_delete', 'delete', '(select public.is_owner())', null);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- Salt okunur tablolar: yalnızca SELECT politikası
-- ---------------------------------------------------------------------
select pg_temp.leonx_policy('public', 'project_status_history', 'owner_select', 'select', '(select public.is_owner())', null);
select pg_temp.leonx_policy('public', 'activity_log', 'owner_select', 'select', '(select public.is_owner())', null);
