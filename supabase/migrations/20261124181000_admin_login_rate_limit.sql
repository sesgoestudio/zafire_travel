-- Brute-force protection for the single-admin password endpoint
create table if not exists public.zafire_admin_login_limits (
  ip_hash text primary key,
  attempts integer not null default 0,
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz
);
alter table public.zafire_admin_login_limits enable row level security;
revoke all on public.zafire_admin_login_limits from anon, authenticated;
grant all on public.zafire_admin_login_limits to service_role;

create or replace function public.zafire_admin_login_allowed(p_ip_hash text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare current_row public.zafire_admin_login_limits%rowtype;
begin
  insert into public.zafire_admin_login_limits(ip_hash, attempts, window_started_at)
  values (p_ip_hash, 1, now())
  on conflict (ip_hash) do update
    set attempts = case when public.zafire_admin_login_limits.window_started_at < now() - interval '15 minutes' then 1 else public.zafire_admin_login_limits.attempts + 1 end,
        window_started_at = case when public.zafire_admin_login_limits.window_started_at < now() - interval '15 minutes' then now() else public.zafire_admin_login_limits.window_started_at end,
        blocked_until = case when public.zafire_admin_login_limits.window_started_at < now() - interval '15 minutes' then null
          when public.zafire_admin_login_limits.attempts + 1 >= 8 then now() + interval '15 minutes'
          else public.zafire_admin_login_limits.blocked_until end;
  select * into current_row from public.zafire_admin_login_limits where ip_hash = p_ip_hash;
  return coalesce(current_row.blocked_until, '-infinity'::timestamptz) <= now() and current_row.attempts <= 8;
end;
$$;
revoke all on function public.zafire_admin_login_allowed(text) from public, anon, authenticated;
grant execute on function public.zafire_admin_login_allowed(text) to service_role;
