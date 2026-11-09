-- Run ONLY after the two migrations, backend and UI are deployed together.
-- Requires pg_cron, pg_net and Vault enabled in Supabase Integrations.
-- Store the same random 32+ byte secret as Render CRON_SECRET and Vault
-- secret named chamba_cron_secret. Never commit its value or put it in a URL.
begin;
do $$ begin
 if not exists(select 1 from pg_extension where extname='pg_cron') or not exists(select 1 from pg_extension where extname='pg_net') then raise exception 'Enable pg_cron and pg_net before scheduling.';end if;
 if not exists(select 1 from vault.decrypted_secrets where name='chamba_cron_secret' and length(decrypted_secret)>=32) then raise exception 'Configure chamba_cron_secret in Vault first.';end if;
 if to_regprocedure('public.chamba_tick()') is null then raise exception 'Apply custody migration first.';end if;
end $$;
-- pg_net stores request headers while sending: browser roles must not read its queue.
revoke all on net.http_request_queue from public,anon,authenticated;
select cron.schedule('chamba-custodia','* * * * *','select public.chamba_tick();');
select cron.schedule('chamba-notificaciones','* * * * *',$job$
 select net.http_post(
  url:='https://chamba-backend-vurx.onrender.com/api/internal/notificaciones',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='chamba_cron_secret')),
  body:='{}'::jsonb,timeout_milliseconds:=120000)
 where exists(select 1 from public.notificaciones where enviado_at is null and proximo_intento<=clock_timestamp() and (lease_hasta is null or lease_hasta<clock_timestamp()));
$job$);
commit;
-- Monitor cron.job_run_details AND notificaciones. An accepted HTTP request
-- is not proof of email delivery. Outbox retry/lease state is authoritative.
