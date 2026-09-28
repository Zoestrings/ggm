-- ==========================================================
-- GGM INSTRUMENTALISTS — PHASE 5: First-Tuesday Enforcement
-- Run this entire script in your Supabase SQL Editor
-- ==========================================================

-- ── 1. Function: validate attendance is on the first Tuesday

create or replace function check_first_tuesday()
returns trigger as $$
declare
  v_activity_date date;
  v_dow           int;
  v_day_of_month  int;
begin
  select activity_date
    into v_activity_date
    from public.activities
   where id = new.activity_id;

  if v_activity_date is null then
    raise exception 'Attendance rejected: activity not found.';
  end if;

  -- Postgres dow: 0=Sunday … 2=Tuesday … 6=Saturday
  v_dow          := extract(dow from v_activity_date)::int;
  v_day_of_month := extract(day from v_activity_date)::int;

  if v_dow <> 2 then
    raise exception
      'Attendance is only allowed on Tuesdays (day-of-week=%).', v_dow;
  end if;

  if v_day_of_month > 7 then
    raise exception
      'Attendance is only allowed on the first Tuesday of the month (day=%).',
      v_day_of_month;
  end if;

  return new;
end;
$$ language plpgsql security definer;

-- ── 2. Attach trigger BEFORE INSERT on attendance ──────────

drop trigger if exists enforce_first_tuesday on public.attendance;

create trigger enforce_first_tuesday
  before insert on public.attendance
  for each row
  execute function check_first_tuesday();

-- ── 3. Avatars storage bucket ──────────────────────────────

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do nothing;

drop policy if exists "Avatar uploads" on storage.objects;
create policy "Avatar uploads"
  on storage.objects for insert
  with check (bucket_id = 'avatars' and auth.role() = 'authenticated');

drop policy if exists "Avatar reads" on storage.objects;
create policy "Avatar reads"
  on storage.objects for select
  using (bucket_id = 'avatars' and auth.role() = 'authenticated');

drop policy if exists "Avatar updates" on storage.objects;
create policy "Avatar updates"
  on storage.objects for update
  using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "Avatar deletes" on storage.objects;
create policy "Avatar deletes"
  on storage.objects for delete
  using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

-- ── 4. Add avatar_url to users ─────────────────────────────

alter table public.users
  add column if not exists avatar_url text;

-- ── 5. Verify trigger (uncomment to run) ───────────────────
-- select trigger_name, event_manipulation, action_timing
--   from information_schema.triggers
--  where event_object_table = 'attendance'
--    and trigger_name = 'enforce_first_tuesday';

-- ── 6. Test first-Tuesday logic in pure SQL ────────────────
-- Expected: 2026-09-01 PASS, 2026-09-08 FAIL,
--           2026-10-06 PASS, 2026-10-07 FAIL
--
-- select d::date,
--        extract(dow from d)::int as dow,
--        extract(day from d)::int as dom,
--        (extract(dow from d)::int = 2
--         and extract(day from d)::int <= 7) as passes
--   from (values ('2026-09-01'::date),('2026-09-08'::date),
--                ('2026-10-06'::date),('2026-10-07'::date)) t(d);
