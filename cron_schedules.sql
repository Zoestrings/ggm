-- =============================================================================
-- GGM INSTRUMENTALISTS ATTENDANCE PORTAL — CRON SCHEDULES (pg_cron & pg_net)
-- Run this in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/dgqpvipmknjktmbinkgz/sql/new
-- =============================================================================

-- ── 0. Enable Required Extensions ───────────────────────────────────────────
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ⚠️ Configuration Notes:
-- 1. Replace <YOUR_CRON_SECRET> with your CRON_SECRET value.
-- 2. Replace <YOUR_SERVICE_ROLE_KEY> with your service_role secret key from Project Settings -> API.


-- ── 1. Auto-Create Next Month's First Tuesday Activity ──────────────────────
-- Runs on the 1st of every month at 00:05 UTC (= 01:05 AM WAT on the 1st).
-- Automatically calculates the First Tuesday of the current month and inserts it.
-- Cron expression: '5 0 1 * *'
select cron.schedule(
  'auto-create-monthly-activity',
  '5 0 1 * *',
  $$
  select
    net.http_post(
      url:='https://dgqpvipmknjktmbinkgz.supabase.co/functions/v1/auto-create-activity',
      headers:=jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', '<YOUR_CRON_SECRET>'
      ),
      body:='{}'::jsonb
    ) as request_id;
  $$
);


-- ── 2. Send Monday Eve Reminder (6:00 PM WAT = 17:00 UTC) ───────────────────
-- Runs every Monday at 17:00 UTC (checks if tomorrow is First Tuesday before sending)
-- Cron expression: '0 17 * * 1'
select cron.schedule(
  'send-eve-attendance-reminder',
  '0 17 * * 1',
  $$
  select
    net.http_post(
      url:='https://dgqpvipmknjktmbinkgz.supabase.co/functions/v1/send-reminder',
      headers:=jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', '<YOUR_CRON_SECRET>'
      ),
      body:=jsonb_build_object('type', 'eve')
    ) as request_id;
  $$
);


-- ── 3. Send Tuesday Morning Reminder (5:30 AM WAT = 04:30 UTC) ──────────────
-- Runs every Tuesday at 04:30 UTC (doors open at 6:00 AM WAT)
-- Cron expression: '30 4 * * 2'
select cron.schedule(
  'send-morning-attendance-reminder',
  '30 4 * * 2',
  $$
  select
    net.http_post(
      url:='https://dgqpvipmknjktmbinkgz.supabase.co/functions/v1/send-reminder',
      headers:=jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', '<YOUR_CRON_SECRET>'
      ),
      body:=jsonb_build_object('type', 'morning')
    ) as request_id;
  $$
);


-- ── 4. Generate & Archive Monthly Attendance PDF ────────────────────
-- Runs on First Tuesday night at 21:15 WAT (20:15 UTC) after the session closes
-- at 21:00 WAT. Compiles the official PDF with photos and saves to 'reports' bucket.
-- Cron expression: '15 20 1-7 * 2' (Tuesday occurring between day 1 and 7)
select cron.schedule(
  'generate-monthly-attendance-pdf',
  '15 20 1-7 * 2',
  $$
  select
    net.http_post(
      url:='https://dgqpvipmknjktmbinkgz.supabase.co/functions/v1/generate-attendance-pdf',
      headers:=jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer <YOUR_SERVICE_ROLE_KEY>'
      ),
      body:='{}'::jsonb
    ) as request_id;
  $$
);
