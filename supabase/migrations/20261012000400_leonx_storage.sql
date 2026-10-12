-- =====================================================================
-- LEONX OS — 004: Özel dosya deposu (Supabase Storage)
--
-- "project-files" bucket'ı ÖZELDİR (public = false): dosyalara herkese
-- açık bağlantı yoktur; indirme yalnızca yetkili oturumla yapılır.
-- Dosya yolu: <project_id>/<benzersiz-ad>. Politikalar hem sahipliği
-- hem de klasörün mevcut bir projeye ait olmasını denetler.
--
-- Boyut sınırı 50 MB (Supabase Free planındaki dosya başına üst sınır).
-- Tekrar çalıştırılabilir: bucket varsa yalnızca ayarları güncellenir.
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

drop policy if exists leonx_project_files_select on storage.objects;
create policy leonx_project_files_select on storage.objects
  for select to authenticated
  using (bucket_id = 'project-files' and (select public.is_owner()));

drop policy if exists leonx_project_files_insert on storage.objects;
create policy leonx_project_files_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'project-files'
    and (select public.is_owner())
    and public.storage_path_belongs_to_project(name)
  );

drop policy if exists leonx_project_files_update on storage.objects;
create policy leonx_project_files_update on storage.objects
  for update to authenticated
  using (bucket_id = 'project-files' and (select public.is_owner()))
  with check (
    bucket_id = 'project-files'
    and (select public.is_owner())
    and public.storage_path_belongs_to_project(name)
  );

drop policy if exists leonx_project_files_delete on storage.objects;
create policy leonx_project_files_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'project-files' and (select public.is_owner()));
