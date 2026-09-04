-- =============================================================================
-- Migration 0009: Auto-create a profile row when a login is created
--
-- profiles.id references auth.users.id, but nothing populated profiles
-- automatically - the app's login page only signs IN (src/app/login/page.tsx
-- has no sign-up UI), and docs/remaining-human-actions.md left "how does the
-- first profile row get created" as an open decision.
--
-- Resolution: every new auth.users row gets a matching profiles row
-- automatically, defaulting to the LEAST-privileged role (sales_associate).
-- This is safe by construction - a brand new login can never grant itself
-- owner access. Promoting the real owner (Nathaniel) to role = 'owner' is
-- still a deliberate, separate, manual step (see docs/deployment-guide.md).
-- =============================================================================

create or replace function handle_new_user() returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role, active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    'sales_associate',
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger trg_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
