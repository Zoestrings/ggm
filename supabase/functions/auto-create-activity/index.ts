// @ts-nocheck
/**
 * auto-create-activity
 *
 * Supabase Edge Function — scheduled via pg_cron or Supabase Dashboard cron.
 * Recommended cron schedule: "5 23 L * *"  (23:05 UTC on the last day of the
 * month = 00:05 Lagos time on the 1st of the next month).
 *
 * What it does:
 *  1. Calculates the first Tuesday of the *next* calendar month (Lagos time).
 *  2. Checks whether an activity already exists for that date.
 *  3. If not, inserts one that opens at 06:00 and closes at 21:00 Lagos time.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Lagos is UTC+1 year-round (no DST).
const LAGOS_OFFSET_HOURS = 1;

/**
 * Return the first Tuesday of the given year/month (0-indexed month).
 * The result is always between the 1st and 7th.
 */
function getFirstTuesday(year: number, month: number): Date {
  // Create the 1st of the month in UTC, then treat it as Lagos local
  const first = new Date(Date.UTC(year, month, 1));
  const dow = first.getUTCDay(); // 0=Sun … 2=Tue … 6=Sat
  const daysUntilTuesday = (2 - dow + 7) % 7; // 0 if already Tuesday
  return new Date(Date.UTC(year, month, 1 + daysUntilTuesday));
}

/** Format a UTC date as ISO string at a specific Lagos hour (e.g. 6 or 21). */
function lagosHourToUTC(date: Date, lagosHour: number): string {
  const utcMs =
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      lagosHour - LAGOS_OFFSET_HOURS, // convert Lagos hour → UTC hour
      0,
      0,
      0
    );
  return new Date(utcMs).toISOString();
}

Deno.serve(async (_req) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // ── Determine target month ─────────────────────────────────────────────
    // "Now" in Lagos time
    const nowUtc = new Date();
    const nowLagos = new Date(nowUtc.getTime() + LAGOS_OFFSET_HOURS * 3600_000);

    // We run on the 1st of the month (Lagos), so target = current month.
    const targetYear  = nowLagos.getUTCFullYear();
    const targetMonth = nowLagos.getUTCMonth(); // 0-indexed

    // ── Calculate first Tuesday ────────────────────────────────────────────
    const firstTuesday = getFirstTuesday(targetYear, targetMonth);
    const activityDateStr = firstTuesday.toISOString().slice(0, 10); // "YYYY-MM-DD"

    // ── Guard: skip if activity already exists for this date ───────────────
    const { data: existing, error: selectErr } = await supabase
      .from('activities')
      .select('id')
      .eq('activity_date', activityDateStr)
      .limit(1);

    if (selectErr) throw selectErr;

    if (existing && existing.length > 0) {
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: 'already_exists', date: activityDateStr }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ── Build open/close timestamps (Lagos 06:00 – 21:00) ─────────────────
    const opensAt  = lagosHourToUTC(firstTuesday, 6);   // 06:00 Lagos = 05:00 UTC
    const closesAt = lagosHourToUTC(firstTuesday, 21);  // 21:00 Lagos = 20:00 UTC

    // Month name for the activity label
    const monthName = firstTuesday.toLocaleString('en-NG', {
      month: 'long',
      year: 'numeric',
      timeZone: 'Africa/Lagos',
    });

    // ── Insert ─────────────────────────────────────────────────────────────
    const { data: inserted, error: insertErr } = await supabase
      .from('activities')
      .insert({
        name:               `Instrument Cleaning — ${monthName}`,
        activity_date:      activityDateStr,
        opens_at:           opensAt,
        closes_at:          closesAt,
        geofence_lat:       5.526180,
        geofence_lng:       5.742390,
        geofence_radius_m:  120,
        max_accuracy_m:     80,
        location_name:      "God's Grace Ministry Int'l Headquarters",
        location_address:   '58 Arubayi Street, Okumagba Layout, Warri, Delta State, Nigeria',
      })
      .select()
      .single();

    if (insertErr) throw insertErr;

    return new Response(
      JSON.stringify({ ok: true, created: true, activity: inserted }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('auto-create-activity error:', err);
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
