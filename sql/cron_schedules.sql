-- =============================================================================
-- GGM INSTRUMENTALISTS ATTENDANCE PORTAL — CRON SCHEDULES (pg_cron & pg_net)
-- Run this in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/dgqpvipmknjktmbinkgz/sql/new
-- =============================================================================

-- ── 0. Enable Required Extensions ───────────────────────────────────────────
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ⚠️ Configuration Notes:
-- 1. Replace test_secret_12345 with your CRON_SECRET value.
-- 2. The service_role key is no longer used in cron jobs.
--    All functions authenticate via x-cron-secret.


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
        'x-cron-secret', 'test_secret_12345'
      ),
      body:='{}'::jsonb
    ) as request_id;
  $$
);


-- ── 2. Send Monthly Reminder (6:00 PM WAT = 17:00 UTC) ───────────────────────
-- Runs daily at 17:00 UTC (6:00 PM WAT). The Edge Function itself
-- checks whether today is the last day of the month and skips if not.
-- Cron expression: '0 17 * * *'

-- Safely unschedule old reminder if previously registered
select cron.unschedule(jobid)
from cron.job
where jobname = 'send-eve-attendance-reminder';

select cron.schedule(
  'send-monthly-attendance-reminder',
  '0 17 * * *',
  $$
  select
    net.http_post(
      url:='https://dgqpvipmknjktmbinkgz.supabase.co/functions/v1/send-reminder',
      headers:=jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', 'test_secret_12345'
      ),
      body:=jsonb_build_object('type', 'monthly_reminder')
    ) as request_id;
  $$
);


-- ── 3. Send Tuesday Morning Reminder (5:30 AM WAT = 04:30 UTC) ──────────────
-- Runs only on the first Tuesday of each month at 04:30 UTC (5:30 AM WAT),
-- approximately 30 minutes before doors open at 6:00 AM WAT.
-- The message body says "at 6:00 AM" — this is the session start time, not push time.
-- Cron expression: '30 4 1-7 * 2' (Tuesdays falling on day 1–7 of the month)
select cron.schedule(
  'send-morning-attendance-reminder',
  '30 4 1-7 * 2',
  $$
  select
    net.http_post(
      url:='https://dgqpvipmknjktmbinkgz.supabase.co/functions/v1/send-reminder',
      headers:=jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', 'test_secret_12345'
      ),
      body:=jsonb_build_object('type', 'morning')
    ) as request_id;
  $$
);


-- ── 4. Generate & Archive Monthly Attendance PDF ────────────────────────────
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
        'x-cron-secret', 'test_secret_12345'
      ),
      body:='{}'::jsonb
    ) as request_id;
  $$
);
