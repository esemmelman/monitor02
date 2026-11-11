create table public.monitor02_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  lease_until timestamptz not null default '1970-01-01T00:00:00Z',
  updated_at timestamptz not null default now()
);
alter table public.monitor02_state enable row level security;
revoke all on public.monitor02_state from anon, authenticated;
grant all on public.monitor02_state to service_role;
comment on table public.monitor02_state is 'Monitor02 state. Only authenticated owner-authorized Edge Function can access; no browser table access.';
