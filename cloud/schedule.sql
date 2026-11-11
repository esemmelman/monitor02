-- Apply once after cloud/schema.sql. Secrets are generated inside Postgres and never returned.
create table public.monitor02_schedule (
 id boolean primary key default true check (id),
 user_id uuid not null references auth.users(id) on delete cascade,
 enabled boolean not null default true,
 game_date date not null,
 secret_hash text not null
);
alter table public.monitor02_schedule enable row level security;
revoke all on public.monitor02_schedule from anon, authenticated;
grant all on public.monitor02_schedule to service_role;
do $setup$
declare token text := encode(extensions.gen_random_bytes(32),'hex');
begin
 perform vault.create_secret(token,'monitor02_cron_token','Monitor02 dedicated scheduler credential');
 insert into public.monitor02_schedule(id,user_id,enabled,game_date,secret_hash)
 select true,id,true,'2026-11-11',encode(extensions.digest(token,'sha256'),'hex')
 from auth.users where lower(email)='esemmoc@gmail.com' and email_confirmed_at is not null;
 if not found then raise exception 'Confirmed Monitor02 owner not found'; end if;
end $setup$;

select cron.schedule('monitor02-every-minute','* * * * *',$job$
 select net.http_post(
  url := 'https://fgomaujsdblpzxhnnqrg.supabase.co/functions/v1/monitor02',
  headers := jsonb_build_object('Content-Type','application/json','x-monitor-secret',
   (select decrypted_secret from vault.decrypted_secrets where name='monitor02_cron_token')),
  body := '{"action":"cron"}'::jsonb,
  timeout_milliseconds := 90000
 ) where (select enabled from public.monitor02_schedule where id=true);
$job$);
