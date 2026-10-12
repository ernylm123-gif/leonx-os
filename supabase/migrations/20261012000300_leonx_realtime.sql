-- =====================================================================
-- LEONX OS — 003: Realtime (cihazlar arası anlık senkronizasyon)
--
-- Tablolar Supabase'in "supabase_realtime" yayınına eklenir. Realtime,
-- postgres_changes olaylarını her abone için RLS politikalarını
-- uygulayarak iletir: yalnızca is_owner() doğru olan oturum olay alır.
-- Silme olaylarında yalnızca birincil anahtar gönderilir.
--
-- Tekrar çalıştırılabilir: tablo yayında zaten varsa atlanır.
-- =====================================================================
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime yayını bulunamadı; Realtime adımı atlandı.';
    return;
  end if;

  foreach t in array array[
    'companies', 'contacts', 'projects', 'project_status_history', 'project_notes', 'project_files'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
