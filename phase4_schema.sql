-- ==========================================================
-- GGM INSTRUMENTALISTS APP - PHASE 4 DATABASE SETUP SCRIPT
-- Run this in your Supabase SQL Editor
-- ==========================================================

-- 1. Create otp_codes table
create table if not exists public.otp_codes (
  id uuid default gen_random_uuid() primary key,
  email text not null,
  code text not null,
  purpose text not null default 'registration',
  expires_at timestamp with time zone not null,
  used_at timestamp with time zone,
  created_at timestamp with time zone default now()
);

alter table public.otp_codes enable row level security;

drop policy if exists "Allow all operations on otp_codes" on public.otp_codes;
create policy "Allow all operations on otp_codes"
on public.otp_codes for all
using (true)
with check (true);

-- 2. Create pending_checkins table
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

alter table public.pending_checkins enable row level security;

drop policy if exists "Allow all operations on pending_checkins" on public.pending_checkins;
create policy "Allow all operations on pending_checkins"
on public.pending_checkins for all
using (true)
with check (true);

-- 3. Add push_token and email_verified to users
alter table public.users
  add column if not exists push_token text,
  add column if not exists email_verified boolean default false;

-- 4. Add location name & address to activities
alter table public.activities
  add column if not exists location_name text default 'God''s Grace Ministry Int''l Headquarters',
  add column if not exists location_address text default '58 Arubayi Street, Okumagba Layout, Warri, Delta State, Nigeria';

-- 5. Lock church location coordinates & 120m radius
update public.activities
set geofence_lat = 5.526180,
    geofence_lng = 5.742390,
    geofence_radius_m = 120,
    max_accuracy_m = 80,
    location_name = 'God''s Grace Ministry Int''l Headquarters',
    location_address = '58 Arubayi Street, Okumagba Layout, Warri, Delta State, Nigeria'
where finalized_at is null;
