-- =====================================================================
-- LEONX OS — 008: Sunucu zamanlayıcısı (pg_cron + pg_net, Supabase ücretsiz planında yerleşik)
--
--   * Her 5 dakikada bir: görev hatırlatmaları, gecikmeler, teslim ve teklif süreleri
--   * Her dakika: bekleyen push bildirimi varsa (veya VAPID anahtarı henüz üretilmediyse)
--     Edge Function "push-dispatch" çağrılır; yoksa hiçbir istek yapılmaz.
--
-- Eklentiler bulunmayan ortamlarda (ör. yerel test PostgreSQL) bu adım sessizce atlanır.
-- Edge Function adresi depoya yazılmaz; kurulumda leonx_private.push_config.dispatch_url
-- alanına SQL ile girilir (docs/SUPABASE_KURULUM.md).
-- Tekrar çalıştırılabilir: cron.schedule aynı adlı işi günceller.
-- =====================================================================

create or replace function leonx_private.dispatch_push()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg leonx_private.push_config;
begin
  select * into v_cfg from leonx_private.push_config where singleton;
  if v_cfg.dispatch_url is null then
    return;
  end if;
  if v_cfg.vapid_public is not null and not exists (
    select 1 from public.notifications where push_state = 'bekliyor' and push_attempts < 5
  ) then
    return;
  end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 15000)'
  using v_cfg.dispatch_url, '{}'::jsonb,
        jsonb_build_object('Content-Type', 'application/json', 'x-leonx-cron', v_cfg.cron_secret);
end;
$$;
revoke all on function leonx_private.dispatch_push() from public;

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net') then
    raise notice 'pg_cron / pg_net bulunamadı; sunucu zamanlayıcısı kurulmadı (uygulama açılışındaki kontrol yine çalışır).';
    return;
  end if;
  execute 'create extension if not exists pg_net';
  execute 'create extension if not exists pg_cron';
  execute $q$select cron.schedule('leonx-hatirlatmalar', '*/5 * * * *', 'select public.leonx_run_reminders()')$q$;
  execute $q$select cron.schedule('leonx-push', '* * * * *', 'select leonx_private.dispatch_push()')$q$;
end;
$$;
