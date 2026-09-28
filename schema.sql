-- ==========================================================
-- GGM INSTRUMENTALISTS APP - COMPLETE SUPABASE SETUP SCRIPT
-- Run this in your Supabase SQL Editor (1-Click Run)
-- ==========================================================

-- 1. Ensure public.users table has all required columns
create table if not exists public.users (
  id uuid primary key references auth.users on delete cascade,
  name text,
  phone text,
  email text,
  instrument text,
  created_at timestamp with time zone default timezone('utc'::text, now())
);
alter table public.users add column if not exists name text;
alter table public.users add column if not exists phone text;
alter table public.users add column if not exists email text;
alter table public.users add column if not exists instrument text;
alter table public.users add column if not exists created_at timestamp with time zone default timezone('utc'::text, now());

alter table public.users enable row level security;
drop policy if exists "Allow all on users" on public.users;
create policy "Allow all on users" on public.users for all using (true) with check (true);

-- 2. Create activities table
create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  activity_date date default current_date,
  opens_at timestamp with time zone not null,
  closes_at timestamp with time zone not null,
  geofence_lat double precision,
  geofence_lng double precision,
  geofence_radius_m integer default 500,
  max_accuracy_m integer default 100,
  finalized_at timestamp with time zone
);
alter table public.activities enable row level security;
drop policy if exists "Allow read activities" on public.activities;
create policy "Allow read activities" on public.activities for select using (true);
drop policy if exists "Allow all activities" on public.activities;
create policy "Allow all activities" on public.activities for all using (true);

-- 3. Create attendance table
create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references auth.users on delete cascade,
  activity_id uuid references public.activities on delete cascade,
  checked_in_at timestamp with time zone default timezone('utc'::text, now()),
  lat double precision,
  lng double precision,
  accuracy_m double precision,
  selfie_url text,
  verification_status text default 'verified',
  constraint unique_member_activity unique (member_id, activity_id)
);
alter table public.attendance enable row level security;
drop policy if exists "Allow all on attendance" on public.attendance;
create policy "Allow all on attendance" on public.attendance for all using (true) with check (true);

-- 4. Create verification_attempts table
create table if not exists public.verification_attempts (
  id uuid primary key default gen_random_uuid(),
  member_id uuid,
  activity_id uuid,
  attempted_at timestamp with time zone default timezone('utc'::text, now()),
  reason text,
  metadata jsonb
);
alter table public.verification_attempts enable row level security;
drop policy if exists "Allow all on verification_attempts" on public.verification_attempts;
create policy "Allow all on verification_attempts" on public.verification_attempts for all using (true) with check (true);

-- 5. Create storage bucket 'selfies'
insert into storage.buckets (id, name, public) 
values ('selfies', 'selfies', false)
on conflict (id) do nothing;

drop policy if exists "Allow authenticated uploads" on storage.objects;
create policy "Allow authenticated uploads" on storage.objects for insert with check (bucket_id = 'selfies');

drop policy if exists "Allow authenticated reads" on storage.objects;
create policy "Allow authenticated reads" on storage.objects for select using (bucket_id = 'selfies');

-- 6. Insert a test open activity for today
insert into public.activities (
  name, 
  opens_at, 
  closes_at, 
  geofence_lat, 
  geofence_lng, 
  geofence_radius_m, 
  max_accuracy_m
)
values (
  'Instrument Cleaning & Sound Check (Test)',
  now() - interval '1 hour',
  now() + interval '12 hours',
  6.5244,
  3.3792,
  500,
  100
);
