-- =============================================================================
-- GGM INSTRUMENTALISTS ATTENDANCE PORTAL — PHASE 6 UPGRADE MIGRATION
-- Run this in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/dgqpvipmknjktmbinkgz/sql/new
-- =============================================================================

-- ── 0. Schema Prerequisites & Supporting Tables ─────────────────────────────
-- Ensures all supporting columns and tables exist so this migration is 100%
-- self-contained and idempotent, even on fresh or partially migrated databases.

-- A. Users table columns
alter table public.users
  add column if not exists role text default 'member',
  add column if not exists username text unique,
  add column if not exists must_change_pw boolean default false,
  add column if not exists push_token text,
  add column if not exists email_verified boolean default false;

-- B. Activities table columns
alter table public.activities
  add column if not exists finalized_at timestamp with time zone,
  add column if not exists location_name text default 'God''s Grace Ministry Int''l Headquarters',
  add column if not exists location_address text default '58 Arubayi Street, Okumagba Layout, Warri, Delta State, Nigeria';

-- C. Attendance table columns
alter table public.attendance
  add column if not exists check_in_method text default 'live',
  add column if not exists marked_by uuid references public.users(id);

-- D. Audit logs table
create table if not exists public.audit_logs (
  id uuid default gen_random_uuid() primary key,
  actor_id uuid references public.users(id),
  action text not null,
  entity text not null,
  entity_id uuid,
  old_value jsonb,
  new_value jsonb,
  reason text,
  created_at timestamp with time zone default now()
);

-- E. Pending check-ins table (offline queue synchronization)
create table if not exists public.pending_checkins (
  id uuid default gen_random_uuid() primary key,
  member_id uuid references public.users(id) on delete cascade,
  activity_id uuid references public.activities(id) on delete cascade,
  captured_at timestamp with time zone not null,
  lat double precision,
  lng double precision,
  accuracy_m double precision,
  selfie_local_uri text,
  selfie_storage_path text,
  failure_reason text,
  status text default 'pending', -- 'pending' | 'approved' | 'rejected'
  approved_by uuid references public.users(id),
  approved_at timestamp with time zone,
  created_at timestamp with time zone default now()
);

-- F. Verification attempts table (records failed geofence/biometric attempts)
create table if not exists public.verification_attempts (
  id uuid primary key default gen_random_uuid(),
  member_id uuid,
  activity_id uuid,
  attempted_at timestamp with time zone default timezone('utc'::text, now()),
  reason text,
  metadata jsonb
);

-- G. OTP codes table
create table if not exists public.otp_codes (
  id uuid default gen_random_uuid() primary key,
  email text not null,
  code text not null,
  purpose text not null default 'registration',
  expires_at timestamp with time zone not null,
  used_at timestamp with time zone,
  created_at timestamp with time zone default now()
);


-- ── 1. Role Helper Function (Security Definer, Stable) ──────────────────────
-- Allows RLS policies on all tables to cleanly and securely read the current user's role.
-- Unauthenticated users return 'anonymous' to prevent unintentional privilege escalation.
create or replace function public.get_my_role()
returns text
security definer
language sql
stable
as $$
  select coalesce(
    (select role from public.users where id = auth.uid()),
    'anonymous'
  );
$$;

grant execute on function public.get_my_role() to authenticated;


-- ── 2. Migrate Existing 'admin' to 'sub_admin' ──────────────────────────────
update public.users
set role = 'sub_admin'
where role = 'admin';


-- ── 3. Role Integrity Triggers ──────────────────────────────────────────────
-- Trigger A: Prevent Demoting the Last Super Admin
create or replace function public.check_last_super_admin()
returns trigger as $$
declare
  v_remaining integer;
begin
  if (TG_OP = 'UPDATE' and OLD.role = 'super_admin' and NEW.role <> 'super_admin') or
     (TG_OP = 'DELETE' and OLD.role = 'super_admin') then
    select count(*) into v_remaining 
      from public.users 
     where role = 'super_admin' 
       and id <> OLD.id;

    if v_remaining < 1 then
      raise exception 'Operation aborted: At least 1 super admin must exist at all times.';
    end if;
  end if;
  return coalesce(NEW, OLD);
end;
$$ language plpgsql security definer;

drop trigger if exists trg_prevent_last_super_admin_demotion on public.users;
create trigger trg_prevent_last_super_admin_demotion
  before update or delete on public.users
  for each row
  execute function public.check_last_super_admin();

-- Trigger B: Prevent Users from Changing Their Own Role
create or replace function public.prevent_self_role_change()
returns trigger as $$
begin
  if OLD.id = auth.uid() 
     and NEW.role <> OLD.role 
     and public.get_my_role() <> 'super_admin' then
    raise exception 'Permission denied: You cannot change your own role.';
  end if;
  return NEW;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_prevent_self_role_change on public.users;
create trigger trg_prevent_self_role_change
  before update on public.users
  for each row
  execute function public.prevent_self_role_change();


-- ── 4. Create reports Table ──────────────────────────────────────────────────
create table if not exists public.reports (
  id uuid default gen_random_uuid() primary key,
  activity_id uuid references public.activities(id) on delete cascade,
  type text not null default 'attendance', -- 'attendance' | 'quarterly'
  storage_path text not null,
  count integer default 0,
  generated_at timestamp with time zone default now(),
  generated_by uuid references public.users(id)
);

alter table public.reports enable row level security;


-- ── 5. Create notifications Table ────────────────────────────────────────────
create table if not exists public.notifications (
  id uuid default gen_random_uuid() primary key,
  member_id uuid references public.users(id) on delete cascade,
  title text not null,
  body text not null,
  type text default 'general',
  read_at timestamp with time zone,
  created_at timestamp with time zone default now()
);

alter table public.notifications enable row level security;


-- ── 6. Storage Buckets & Policies ───────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('reports', 'reports', false)
on conflict (id) do nothing;

drop policy if exists "Super admins have full reports storage access" on storage.objects;
create policy "Super admins have full reports storage access"
on storage.objects for all
using (bucket_id = 'reports' and public.get_my_role() = 'super_admin')
with check (bucket_id = 'reports' and public.get_my_role() = 'super_admin');


-- ── 7. Secure Admin Role Management Functions ────────────────────────────────
-- Function: Promote Member to Sub Admin
create or replace function public.promote_to_sub_admin(target uuid)
returns void language plpgsql security definer as $$
declare
  v_old_role text;
begin
  if public.get_my_role() != 'super_admin' then
    raise exception 'Permission denied: Only super admins can promote users.';
  end if;

  select role into v_old_role from public.users where id = target;
  
  update public.users set role = 'sub_admin' where id = target;

  insert into public.audit_logs (actor_id, action, entity, entity_id, old_value, new_value)
  values (
    auth.uid(),
    'promote_to_sub_admin',
    'users',
    target,
    jsonb_build_object('role', coalesce(v_old_role, 'member')),
    jsonb_build_object('role', 'sub_admin')
  );
end;
$$;

-- Function: Demote Sub Admin to Member
create or replace function public.demote_to_member(target uuid)
returns void language plpgsql security definer as $$
declare
  v_old_role text;
begin
  if public.get_my_role() != 'super_admin' then
    raise exception 'Permission denied: Only super admins can demote users.';
  end if;

  select role into v_old_role from public.users where id = target;

  update public.users set role = 'member' where id = target;

  insert into public.audit_logs (actor_id, action, entity, entity_id, old_value, new_value)
  values (
    auth.uid(),
    'demote_to_member',
    'users',
    target,
    jsonb_build_object('role', coalesce(v_old_role, 'sub_admin')),
    jsonb_build_object('role', 'member')
  );
end;
$$;

-- Function: Transfer Super Admin Role
create or replace function public.transfer_super_admin(target uuid)
returns void language plpgsql security definer as $$
begin
  if public.get_my_role() != 'super_admin' then
    raise exception 'Permission denied: Only super admins can transfer this role.';
  end if;

  update public.users set role = 'super_admin' where id = target;

  insert into public.audit_logs (actor_id, action, entity, entity_id, old_value, new_value)
  values (
    auth.uid(),
    'transfer_super_admin',
    'users',
    target,
    jsonb_build_object('role', 'sub_admin'),
    jsonb_build_object('role', 'super_admin')
  );
end;
$$;

grant execute on function public.promote_to_sub_admin(uuid) to authenticated;
grant execute on function public.demote_to_member(uuid) to authenticated;
grant execute on function public.transfer_super_admin(uuid) to authenticated;


-- ── 8. Top Performers RPC Function ──────────────────────────────────────────
-- Returns service evaluation based on the last 3 finalized activities:
-- Tier 1: 100% (3 of 3)
-- Tier 2:  70% (2 of 3)
-- Tier 3:  40% (1 of 3)
-- Tier 4:   0% (0 of 3)
create or replace function public.get_top_performers()
returns table (
  member_id uuid,
  name text,
  instrument text,
  avatar_url text,
  phone text,
  attended_count bigint,
  total_activities bigint,
  attendance_pct numeric,
  tier text,
  badge text
)
language sql
security definer
stable
as $$
  with recent_finalized_activities as (
    select id, activity_date
    from public.activities
    where finalized_at is not null
    order by activity_date desc
    limit 3
  ),
  activity_stats as (
    select count(*) as total_count from recent_finalized_activities
  ),
  member_attendance as (
    select
      u.id as member_id,
      u.name,
      u.instrument,
      u.avatar_url,
      u.phone,
      count(distinct a.activity_id) as attended_count,
      s.total_count as total_activities
    from public.users u
    cross join activity_stats s
    left join public.attendance a
      on a.member_id = u.id
      and a.activity_id in (select id from recent_finalized_activities)
    where coalesce(u.role, 'member') != 'super_admin'
    group by u.id, u.name, u.instrument, u.avatar_url, u.phone, s.total_count
  )
  select
    member_id,
    coalesce(name, 'Unknown Member') as name,
    coalesce(instrument, 'Not specified') as instrument,
    avatar_url,
    phone,
    attended_count,
    total_activities,
    case
      when total_activities = 0 then 0
      else round((attended_count::numeric / total_activities::numeric) * 100, 1)
    end as attendance_pct,
    case
      when total_activities > 0 and attended_count = total_activities then '100%'
      when total_activities > 0 and attended_count = total_activities - 1 then '70%'
      when attended_count > 0 then '40%'
      else '0%'
    end as tier,
    case
      when total_activities > 0 and attended_count = total_activities then '🥇 Gold'
      when total_activities > 0 and attended_count = total_activities - 1 then '🥈 Silver'
      when attended_count > 0 then '🥉 Bronze'
      else 'None'
    end as badge
  from member_attendance
  order by attended_count desc, name asc;
$$;

grant execute on function public.get_top_performers() to authenticated;


-- ── 9. Row Level Security Policies ──────────────────────────────────────────

-- ── [users table] ──
alter table public.users enable row level security;

drop policy if exists "Allow all on users" on public.users;
drop policy if exists "Members read own user record" on public.users;
drop policy if exists "Super admin reads all users" on public.users;
drop policy if exists "Sub admin reads all user names" on public.users;
drop policy if exists "Authenticated insert users" on public.users;
drop policy if exists "Users update own profile" on public.users;

create policy "Members read own user record"
on public.users for select
using (id = auth.uid());

create policy "Super admin reads all users"
on public.users for select
using (public.get_my_role() = 'super_admin');

create policy "Sub admin reads all user names"
on public.users for select
using (public.get_my_role() = 'sub_admin');

create policy "Authenticated insert users"
on public.users for insert
with check (id = auth.uid() or public.get_my_role() = 'super_admin');

-- Users can update own profile (role changes are blocked by trg_prevent_self_role_change trigger)
create policy "Users update own profile"
on public.users for update
using (id = auth.uid() or public.get_my_role() = 'super_admin')
with check (id = auth.uid() or public.get_my_role() = 'super_admin');


-- ── [attendance table] ──
alter table public.attendance enable row level security;

drop policy if exists "Allow all on attendance" on public.attendance;
drop policy if exists "Super admin full attendance access" on public.attendance;
drop policy if exists "Sub admin read current activity attendance" on public.attendance;
drop policy if exists "Member read own attendance" on public.attendance;
drop policy if exists "Member insert live checkin" on public.attendance;

create policy "Super admin full attendance access"
on public.attendance for all
using (public.get_my_role() = 'super_admin')
with check (public.get_my_role() = 'super_admin');

-- Sub admin can view attendance for an open activity, or one closed within the last 30 days
create policy "Sub admin read current activity attendance"
on public.attendance for select
using (
  public.get_my_role() = 'sub_admin'
  and activity_id = (
    select id from public.activities
    where finalized_at is null
       or closes_at >= now() - interval '30 days'
    order by opens_at desc
    limit 1
  )
);

create policy "Member read own attendance"
on public.attendance for select
using (member_id = auth.uid());

-- Clean, robust insert policy: checks check_in_method value and enforces non-finalized activity + 24h grace window
create policy "Member insert live checkin"
on public.attendance for insert
with check (
  member_id = auth.uid()
  and check_in_method in ('live', 'offline_sync')
  and activity_id in (
    select id from public.activities
    where finalized_at is null
      and now() <= closes_at + interval '24 hours'
  )
);


-- ── [activities table] ──
alter table public.activities enable row level security;

drop policy if exists "Allow read activities" on public.activities;
drop policy if exists "Allow all activities" on public.activities;
drop policy if exists "Authenticated read activities" on public.activities;
drop policy if exists "Super admin manage activities" on public.activities;

create policy "Authenticated read activities"
on public.activities for select
using (auth.role() = 'authenticated');

create policy "Super admin manage activities"
on public.activities for all
using (public.get_my_role() = 'super_admin')
with check (public.get_my_role() = 'super_admin');


-- ── [reports table] ──
drop policy if exists "Super admin reports access" on public.reports;
create policy "Super admin reports access"
on public.reports for all
using (public.get_my_role() = 'super_admin')
with check (public.get_my_role() = 'super_admin');


-- ── [notifications table] ──
drop policy if exists "Members read own notifications" on public.notifications;
create policy "Members read own notifications"
on public.notifications for select
using (member_id = auth.uid());

drop policy if exists "Members update own notifications" on public.notifications;
create policy "Members update own notifications"
on public.notifications for update
using (member_id = auth.uid())
with check (member_id = auth.uid());

drop policy if exists "Super admin manage notifications" on public.notifications;
create policy "Super admin manage notifications"
on public.notifications for all
using (public.get_my_role() = 'super_admin')
with check (public.get_my_role() = 'super_admin');


-- ── [audit_logs table] ──
alter table public.audit_logs enable row level security;

drop policy if exists "Admins can read audit logs" on public.audit_logs;
drop policy if exists "Allow insert into audit_logs" on public.audit_logs;
drop policy if exists "Super admin reads audit logs" on public.audit_logs;
drop policy if exists "System and admins insert audit logs" on public.audit_logs;

create policy "Super admin reads audit logs"
on public.audit_logs for select
using (public.get_my_role() = 'super_admin');

-- NOTE: No client direct insert policy. Security definer functions and service role write to audit_logs bypassing RLS.


-- ── [pending_checkins table] ──
alter table public.pending_checkins enable row level security;

drop policy if exists "Allow all operations on pending_checkins" on public.pending_checkins;
drop policy if exists "Super admin manage pending checkins" on public.pending_checkins;
drop policy if exists "Sub admin read current pending checkins" on public.pending_checkins;
drop policy if exists "Member manage own pending checkins" on public.pending_checkins;
drop policy if exists "Member insert own pending checkin" on public.pending_checkins;

create policy "Super admin manage pending checkins"
on public.pending_checkins for all
using (public.get_my_role() = 'super_admin')
with check (public.get_my_role() = 'super_admin');

create policy "Sub admin read current pending checkins"
on public.pending_checkins for select
using (
  public.get_my_role() = 'sub_admin'
  and activity_id = (
    select id from public.activities
    where finalized_at is null
       or closes_at >= now() - interval '30 days'
    order by opens_at desc
    limit 1
  )
);

create policy "Member manage own pending checkins"
on public.pending_checkins for select
using (member_id = auth.uid());

create policy "Member insert own pending checkin"
on public.pending_checkins for insert
with check (member_id = auth.uid());


-- ── [verification_attempts table] ──
alter table public.verification_attempts enable row level security;

drop policy if exists "Allow all on verification_attempts" on public.verification_attempts;
drop policy if exists "Super admin read verification attempts" on public.verification_attempts;
drop policy if exists "Authenticated insert verification attempt" on public.verification_attempts;

create policy "Super admin read verification attempts"
on public.verification_attempts for select
using (public.get_my_role() = 'super_admin');

create policy "Authenticated insert verification attempt"
on public.verification_attempts for insert
with check (auth.role() = 'authenticated');


-- ── [otp_codes table] ──
alter table public.otp_codes enable row level security;

drop policy if exists "Allow all operations on otp_codes" on public.otp_codes;
create policy "Allow all operations on otp_codes"
on public.otp_codes for all
using (true)
with check (true);
