-- ==========================================================
-- GGM INSTRUMENTALISTS: Allow Attendance on EVERY Tuesday
-- Run this in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/dgqpvipmknjktmbinkgz/sql/new
-- ==========================================================

create or replace function check_first_tuesday()
returns trigger as $$
declare
  v_activity_date date;
  v_dow           int;
begin
  select activity_date
    into v_activity_date
    from public.activities
   where id = new.activity_id;

  if v_activity_date is null then
    raise exception 'Attendance rejected: activity not found.';
  end if;

  -- Postgres dow: 0=Sunday … 2=Tuesday … 6=Saturday
  v_dow := extract(dow from v_activity_date)::int;

  -- Allows attendance on EVERY Tuesday (removes the 1st-to-7th limitation)
  if v_dow <> 2 then
    raise exception
      'Attendance is only allowed on Tuesdays (day-of-week=%).', v_dow;
  end if;

  return new;
end;
$$ language plpgsql security definer;
