-- Run once in the SQL editor of your own Supabase project.
-- Only the server's service_role can access these snapshots. No browser key is used.
create table if not exists public.cytophage_world (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.cytophage_world enable row level security;
revoke all on public.cytophage_world from anon, authenticated;
grant all on public.cytophage_world to service_role;
