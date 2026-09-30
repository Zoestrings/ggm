-- =============================================================================
-- GGM INSTRUMENTALISTS ATTENDANCE PORTAL — TOP PERFORMERS CANONICAL QUERY
-- Basis: The last 3 finalized activities (finalized_at is not null)
-- Tiers: 3/3 -> 100%, 2/3 -> 70%, 1/3 -> 40%, 0/3 -> Hidden (count only)
-- =============================================================================

with recent_activities as (
  -- The last 3 finalized activities, newest to oldest
  select id, activity_date, name
  from public.activities
  where finalized_at is not null
  order by activity_date desc
  limit 3
),
total_activities as (
  select count(*) as activity_count from recent_activities
),
activity_range as (
  select min(activity_date) as start_date, max(activity_date) as end_date
  from recent_activities
),
member_attendance as (
  select 
    u.id as member_id,
    u.name as member_name,
    count(distinct ra.id) as months_attended
  from public.users u
  left join public.attendance att on att.member_id = u.id
  left join recent_activities ra on ra.id = att.activity_id
  where u.role = 'member'
    and coalesce(u.status, 'active') = 'active'
  group by u.id, u.name
)
select 
  ma.member_id,
  ma.member_name,
  coalesce(ma.months_attended, 0) as months_attended,
  ta.activity_count as total_activities,
  ar.start_date,
  ar.end_date,
  case 
    when coalesce(ma.months_attended, 0) >= 3 then 100
    when coalesce(ma.months_attended, 0) = 2 then 70
    when coalesce(ma.months_attended, 0) = 1 then 40
    else 0
  end as percentage_tier
from member_attendance ma, total_activities ta, activity_range ar
order by ma.months_attended desc, ma.member_name asc;
