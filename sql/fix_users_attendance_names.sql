-- =============================================================================
-- GGM INSTRUMENTALISTS APP — FIX USERS & ATTENDANCE NAMES & PICTURES
-- Run this in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/dgqpvipmknjktmbinkgz/sql/new
-- =============================================================================

-- 0. Make password_hash nullable so auth-managed users insert cleanly
do $$
begin
  if exists (
    select 1 from information_schema.columns 
    where table_name = 'users' and column_name = 'password_hash'
  ) then
    alter table public.users alter column password_hash drop not null;
    alter table public.users alter column password_hash set default 'managed_by_supabase_auth';
  end if;
end $$;

-- 1. Ensure public.attendance has a direct foreign key to public.users
-- This allows PostgREST relationship joins like `user:users(...)` to work flawlessly.
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints 
    where constraint_name = 'attendance_member_id_users_fkey'
      and table_name = 'attendance'
  ) then
    alter table public.attendance
      add constraint attendance_member_id_users_fkey
      foreign key (member_id) references public.users(id) on delete cascade;
  end if;
end $$;

-- 2. Update RLS on public.users so authenticated church members and admins
-- can read member directory details (name, instrument, phone, email, avatar)
-- for attendance verification and display.
alter table public.users enable row level security;

drop policy if exists "Allow all on users" on public.users;
drop policy if exists "Members read own user record" on public.users;
drop policy if exists "Super admin reads all users" on public.users;
drop policy if exists "Sub admin reads all user names" on public.users;
drop policy if exists "Authenticated users read directory" on public.users;

create policy "Authenticated users read directory"
on public.users for select
to authenticated
using (true);

-- 3. Ensure authenticated users can insert and update their own user profile
drop policy if exists "Authenticated insert users" on public.users;
create policy "Authenticated insert users"
on public.users for insert
to authenticated
with check (id = auth.uid() or public.get_my_role() in ('super_admin', 'sub_admin', 'admin'));

drop policy if exists "Users update own profile" on public.users;
create policy "Users update own profile"
on public.users for update
to authenticated
using (id = auth.uid() or public.get_my_role() in ('super_admin', 'sub_admin', 'admin'))
with check (id = auth.uid() or public.get_my_role() in ('super_admin', 'sub_admin', 'admin'));

-- 4. Automatically sync all existing auth.users into public.users so that
-- any existing accounts that were missing names are restored immediately.
-- Also replaces any generic 'Musician' placeholders with the member's real instrument.
insert into public.users (id, name, email, phone, instrument, role, password_hash)
select 
  id, 
  coalesce(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', email),
  email,
  coalesce(raw_user_meta_data->>'phone', ''),
  coalesce(nullif(raw_user_meta_data->>'instrument', ''), 'Keyboard'),
  coalesce(raw_user_meta_data->>'role', 'member'),
  'managed_by_supabase_auth'
from auth.users
on conflict (id) do update set
  name = coalesce(public.users.name, excluded.name),
  email = coalesce(public.users.email, excluded.email),
  phone = coalesce(nullif(public.users.phone, ''), excluded.phone),
  instrument = coalesce(
    nullif(nullif(excluded.instrument, ''), 'Musician'),
    nullif(nullif(public.users.instrument, ''), 'Musician'),
    'Keyboard'
  );

-- 5. Trigger to automatically populate public.users whenever anyone signs up
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, name, email, phone, instrument, role, password_hash)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', new.email),
    new.email,
    coalesce(new.raw_user_meta_data->>'phone', ''),
    coalesce(nullif(new.raw_user_meta_data->>'instrument', ''), 'Keyboard'),
    coalesce(new.raw_user_meta_data->>'role', 'member'),
    'managed_by_supabase_auth'
  )
  on conflict (id) do update set
    name = coalesce(public.users.name, excluded.name),
    email = coalesce(public.users.email, excluded.email),
    instrument = coalesce(
      nullif(nullif(excluded.instrument, ''), 'Musician'),
      public.users.instrument
    );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
