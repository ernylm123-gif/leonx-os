-- =====================================================================
-- LEONX OS — 004: Özel dosya deposu (Supabase Storage)
--
-- "project-files" bucket'ı ÖZELDİR (public = false): dosyalara herkese
-- açık bağlantı yoktur; indirme yalnızca yetkili oturumla yapılır.
-- Dosya yolu: <project_id>/<benzersiz-ad>. Politikalar hem sahipliği
-- hem de klasörün mevcut bir projeye ait olmasını denetler.
--
-- Boyut sınırı 50 MB (Supabase Free planındaki dosya başına üst sınır).
-- Tekrar çalıştırılabilir: bucket varsa yalnızca ayarları güncellenir;
-- politikalar yoksa oluşturulur, varsa ALTER POLICY ile güncellenir (silme yok).
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-files',
  'project-files',
  false,
  52428800,
  array[
    'application/pdf',
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
    'application/acad', 'application/x-acad', 'application/autocad_dwg', 'image/vnd.dwg', 'image/x-dwg',
    'application/dxf', 'image/vnd.dxf', 'image/x-dxf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain', 'text/csv',
    'application/zip', 'application/x-zip-compressed',
    'application/octet-stream'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Yol bir projeye ait mi? (ilk klasör adı = mevcut proje kimliği)
create or replace function public.storage_path_belongs_to_project(object_name text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.projects p
    where p.id::text = split_part(object_name, '/', 1)
  );
$$;

revoke all on function public.storage_path_belongs_to_project(text) from public, anon;
grant execute on function public.storage_path_belongs_to_project(text) to authenticated;

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

select pg_temp.leonx_policy('storage', 'objects', 'leonx_project_files_select', 'select',
  $$bucket_id = 'project-files' and (select public.is_owner())$$, null);

select pg_temp.leonx_policy('storage', 'objects', 'leonx_project_files_insert', 'insert', null,
  $$bucket_id = 'project-files' and (select public.is_owner()) and public.storage_path_belongs_to_project(name)$$);

select pg_temp.leonx_policy('storage', 'objects', 'leonx_project_files_update', 'update',
  $$bucket_id = 'project-files' and (select public.is_owner())$$,
  $$bucket_id = 'project-files' and (select public.is_owner()) and public.storage_path_belongs_to_project(name)$$);

select pg_temp.leonx_policy('storage', 'objects', 'leonx_project_files_delete', 'delete',
  $$bucket_id = 'project-files' and (select public.is_owner())$$, null);
