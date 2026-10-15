-- =====================================================================
-- LEONX OS — 012: Mühendislik incelemesi ve metraj izlenebilirliği (Faz 5.2)
--
--   quantity_items
--     uncertain    "Belirsiz" işareti (kullanıcı karar veremedi; kesin toplama dahil değil)
--     review_note  İnceleme notu (neden düzeltildi / reddedildi / belirsiz)
--     approved_by  Onaylayan kullanıcı (sunucu yazar; istemci değeri yok sayılır)
--     approved_at  Onay zamanı (sunucu yazar)
--     original     Otomatik tespitin ilk değerleri (ölçü, adet, iş grubu); sonradan DEĞİŞTİRİLEMEZ.
--                  Kullanıcı düzeltmesi, original ile güncel değerin farkıdır; ayrıntısı
--                  quantity_item_history tablosundadır.
--   cad_analyses
--     file_hash    Analiz edilen dosyanın SHA-256 özeti (aynı dosyanın yeniden analizi tanınır)
--
--   Bildirimler (mevcut sistem): analiz başladı (istemci), ölçü/adet çelişkisi bulundu,
--   metraj doğrulama bekliyor. CAD dosyası yüklenince bildirim başlığı "CAD dosyası" olur.
--
-- Tekrar çalıştırılabilir; nesne kaldırma veya veri silme içermez. Mevcut veriye dokunmaz.
-- =====================================================================

alter table public.quantity_items add column if not exists uncertain boolean not null default false;
alter table public.quantity_items add column if not exists review_note text;
alter table public.quantity_items add column if not exists approved_by uuid;
alter table public.quantity_items add column if not exists approved_at timestamptz;
alter table public.quantity_items add column if not exists original jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'quantity_items_review_note_check') then
    alter table public.quantity_items add constraint quantity_items_review_note_check
      check (review_note is null or char_length(review_note) <= 1000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quantity_items_original_check') then
    alter table public.quantity_items add constraint quantity_items_original_check
      check (original is null or (jsonb_typeof(original) = 'object' and pg_column_size(original) <= 4096));
  end if;
end;
$$;

alter table public.cad_analyses add column if not exists file_hash text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cad_analyses_file_hash_check') then
    alter table public.cad_analyses add constraint cad_analyses_file_hash_check
      check (file_hash is null or file_hash ~ '^[0-9a-f]{64}$');
  end if;
end;
$$;
create index if not exists cad_analyses_hash_idx on public.cad_analyses (project_id, file_hash) where file_hash is not null;

-- ---------------------------------------------------------------------
-- İnceleme alanlarının bütünlüğü (istemciye güvenilmez)
-- ---------------------------------------------------------------------
create or replace function public.tg_quantity_item_review()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_d jsonb;
begin
  if tg_op = 'INSERT' then
    -- Otomatik tespit edilen pozun ilk değerleri (elle girilen pozda boş). Kullanıcı öneriyi eklemeden
    -- önce düzelttiyse motorun ham sonucu detection.detected içinde gelir; ilk değer odur.
    if new.detection is not null then
      v_d := case when jsonb_typeof(new.detection -> 'detected') = 'object' then new.detection -> 'detected' else '{}'::jsonb end;
      new.original := jsonb_build_object(
        'poz_code', coalesce(v_d ->> 'poz_code', new.poz_code),
        'category', coalesce(v_d ->> 'category', new.category),
        'shape', new.shape,
        'width_mm', coalesce(v_d -> 'width_mm', to_jsonb(new.width_mm)),
        'height_mm', coalesce(v_d -> 'height_mm', to_jsonb(new.height_mm)),
        'quantity', coalesce(v_d -> 'quantity', to_jsonb(new.quantity)),
        'unit', new.unit, 'verification', new.verification);
    else
      new.original := null;
    end if;
    if new.verification = 'onaylandi' then
      new.approved_by := auth.uid();
      new.approved_at := now();
      new.uncertain := false;
    else
      new.approved_by := null;
      new.approved_at := null;
    end if;
    return new;
  end if;
  -- UPDATE: ilk değerler değiştirilemez
  new.original := old.original;
  if new.verification = 'onaylandi' then
    if old.verification is distinct from 'onaylandi' then
      new.approved_by := auth.uid();
      new.approved_at := now();
    else
      new.approved_by := old.approved_by;
      new.approved_at := old.approved_at;
    end if;
    new.uncertain := false;
  else
    new.approved_by := null;
    new.approved_at := null;
  end if;
  return new;
end;
$$;
create or replace trigger quantity_item_review
  before insert or update on public.quantity_items
  for each row execute function public.tg_quantity_item_review();
revoke all on function public.tg_quantity_item_review() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- CAD analizi kaydı: mevcut olaylar + çelişki ve doğrulama bekleyen bildirimleri
-- ---------------------------------------------------------------------
create or replace function public.tg_wf_cad()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conflicts integer := 0;
  v_link text := '/projeler/' || new.project_id;
begin
  perform public.leonx_event(new.project_id, 'cad_analiz',
    case when new.status = 'hatali' then 'CAD analizi hata verdi' else 'CAD analizi kaydedildi' end,
    new.file_name || ' · ' || new.candidate_count || ' aday', 'cad_analysis', new.id, 'cad:' || new.id);
  perform public.leonx_notify('cad', case when new.status = 'hatali' then 'cad_hata' else 'cad_tamam' end,
    case when new.status = 'hatali' then 'CAD analizi hata verdi: ' else 'CAD analizi tamamlandı: ' end || new.file_name,
    new.candidate_count || ' poz adayı', v_link, 'project', new.project_id, 'cad:' || new.id);
  if jsonb_typeof(new.summary -> 'tespit' -> 'celiski') = 'number' then
    v_conflicts := (new.summary -> 'tespit' ->> 'celiski')::integer;
  end if;
  if v_conflicts > 0 then
    perform public.leonx_event(new.project_id, 'cad_celiski', 'Ölçü / adet çelişkisi bulundu',
      new.file_name || ' · ' || v_conflicts || ' poz', 'cad_analysis', new.id, 'cad:' || new.id || ':celiski');
    perform public.leonx_notify('cad', 'cad_celiski', 'Çelişki bulundu: ' || new.file_name,
      v_conflicts || ' pozda çizelge, plan veya görünüş birbiriyle uyuşmuyor; karar sizin', v_link, 'project', new.project_id,
      'cad:' || new.id || ':celiski');
  end if;
  if new.status <> 'hatali' and new.candidate_count > 0 then
    perform public.leonx_notify('cad', 'metraj_dogrulama', 'Metraj doğrulama bekliyor: ' || new.file_name,
      new.candidate_count || ' poz adayı mühendislik incelemesi bekliyor', v_link, 'project', new.project_id,
      'cad:' || new.id || ':dogrulama');
  end if;
  return null;
end;
$$;
revoke all on function public.tg_wf_cad() from public, anon, authenticated;

-- CAD dosyası yüklenince başlık "CAD dosyası" olur (diğer dosyalarda aynen)
create or replace function public.tg_wf_file()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cad boolean := lower(new.file_name) ~ '\.(dxf|dwg|pdf)$';
begin
  perform public.leonx_event(new.project_id, 'dosya', 'Dosya yüklendi', new.file_name, 'project_file', new.id, 'file:' || new.id);
  perform public.leonx_notify('proje', case when v_cad then 'cad_dosya' else 'dosya_yeni' end,
    case when v_cad then 'CAD / çizim dosyası yüklendi: ' else 'Yeni dosya: ' end || new.file_name,
    (select code || ' · ' || name from public.projects where id = new.project_id),
    '/projeler/' || new.project_id, 'project', new.project_id, 'file:' || new.id);
  return null;
end;
$$;
revoke all on function public.tg_wf_file() from public, anon, authenticated;

-- İstemci kaynaklı olaylar: + "CAD analizi başladı" (kullanıcının kendi işlemi; tercihe tabi)
create or replace function public.notify_client_event(p_kind text, p_title text, p_body text, p_link text, p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'Yetkisiz' using errcode = '42501';
  end if;
  if p_kind not in ('surum_yeni', 'cad_hata', 'push_test', 'cad_basladi') then
    raise exception 'Geçersiz olay türü' using errcode = '22023';
  end if;
  if p_link is not null and p_link !~ '^/' then
    raise exception 'Geçersiz bağlantı' using errcode = '22023';
  end if;
  perform public.leonx_notify(case when p_kind in ('cad_hata', 'cad_basladi') then 'cad' else 'sistem' end, p_kind,
    left(p_title, 200), left(p_body, 500), left(p_link, 300), null, null, p_kind || ':' || left(p_key, 150),
    p_kind in ('surum_yeni', 'push_test'));
end;
$$;
revoke all on function public.notify_client_event(text, text, text, text, text) from public, anon;
grant execute on function public.notify_client_event(text, text, text, text, text) to authenticated;
