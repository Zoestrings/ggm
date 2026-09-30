-- =============================================================================
-- HISTORICAL FILE — DO NOT REUSE
-- This file was used during initial development setup.
-- Any real credentials, seed data, or developer info have been removed from
-- the live app. Do not copy values from this file into new migrations.
-- =============================================================================
-- ==========================================================
-- GGM INSTRUMENTALISTS APP - PHASE 3 ADMIN SETUP SQL
-- Run this in your Supabase SQL Editor
-- ==========================================================

-- 1. Create audit_logs table
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

alter table public.audit_logs enable row level security;

drop policy if exists "Admins can read audit logs" on public.audit_logs;
create policy "Admins can read audit logs"
on public.audit_logs for select
using (
  exists (
    select 1 from public.users
    where id = auth.uid()
    and role in ('admin', 'super_admin')
  )
);

drop policy if exists "Allow insert into audit_logs" on public.audit_logs;
create policy "Allow insert into audit_logs"
on public.audit_logs for insert
with check (true);

-- 2. Add admin fields & role to users table
alter table public.users
  add column if not exists role text default 'member',
  add column if not exists username text unique,
  add column if not exists email text,
  add column if not exists must_change_pw boolean default false,
  add column if not exists created_by uuid references public.users(id),
  add column if not exists provisioned_at timestamp with time zone,
  add column if not exists activated_at timestamp with time zone;

-- 3. Seed your Super Admin account
-- (Update with your registered phone number or email)
update public.users
set role = 'super_admin',
    username = 'superadmin',
    must_change_pw = false
where phone = '08119704551' 
   or email = 'akpodomagoodluck9@gmail.com';
