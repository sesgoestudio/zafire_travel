-- ZAFIRE single-admin password access (no Supabase Auth users required)
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.zafire_admin_credentials (
  id boolean primary key default true check (id = true),
  password_hash text not null,
  updated_at timestamptz not null default now()
);
alter table public.zafire_admin_credentials enable row level security;
revoke all on public.zafire_admin_credentials from anon, authenticated;
grant all on public.zafire_admin_credentials to service_role;

create table if not exists public.zafire_admin_sessions (
  token_hash text primary key,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.zafire_admin_sessions enable row level security;
revoke all on public.zafire_admin_sessions from anon, authenticated;
grant all on public.zafire_admin_sessions to service_role;

create or replace function public.zafire_verify_admin_password(p_password text)
returns boolean
language sql
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.zafire_admin_credentials
    where id = true and password_hash = crypt(p_password, password_hash)
  );
$$;
revoke all on function public.zafire_verify_admin_password(text) from public, anon, authenticated;
grant execute on function public.zafire_verify_admin_password(text) to service_role;

-- Admin-only access is now handled by the Edge Function session, not Auth users.
-- Legacy team tables are retained to avoid destructive changes to historical data.
