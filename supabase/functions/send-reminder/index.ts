// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const cronSecret = Deno.env.get("CRON_SECRET");
    const secretHeader = req.headers.get("x-cron-secret");
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Authorization: check x-cron-secret, service_role, or super_admin
    let isAuthorized = false;

    if (cronSecret && secretHeader === cronSecret) {
      isAuthorized = true;
    } else if (supabaseServiceKey && authHeader.includes(supabaseServiceKey)) {
      isAuthorized = true;
    } else if (authHeader.startsWith("Bearer ")) {
      const userToken = authHeader.replace("Bearer ", "");
      const { data: { user } } = await supabase.auth.getUser(userToken);
      if (user) {
        const { data: profile } = await supabase
          .from("users")
          .select("role")
          .eq("id", user.id)
          .single();
        if (profile?.role === "super_admin") {
          isAuthorized = true;
        }
      }
    }

    if (!isAuthorized) {
      return new Response(
        JSON.stringify({ error: "Unauthorized. Valid x-cron-secret or Super Admin authorization required." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Parse payload
    let reminderType = "monthly_reminder"; // 'monthly_reminder' | 'morning' | 'eve'
    let force = false;
    try {
      const body = await req.json();
      if (body?.type) reminderType = body.type;
      if (body?.force) force = Boolean(body.force);
    } catch (_err) {
      // default is monthly_reminder
    }

    // 3. Determine current WAT time and date
    const nowUtc = new Date();
    // West Africa Time (WAT = UTC+1)
    const nowWat = new Date(nowUtc.getTime() + 1 * 3600_000);
    const currentYear = nowWat.getUTCFullYear();
    const currentMonth = nowWat.getUTCMonth(); // 0-indexed: 0 = Jan, 1 = Feb, ...
    const currentDay = nowWat.getUTCDate();

    // Total days in current month (day 0 of next month gives last day of current)
    const daysInMonth = new Date(Date.UTC(currentYear, currentMonth + 1, 0)).getUTCDate();
    const isLastDayOfMonth = (currentDay === daysInMonth);

    // If scheduled monthly reminder, verify today is the last day of the month (e.g. 30th/31st, or 28th/29th in Feb)
    if (reminderType === "monthly_reminder" && !isLastDayOfMonth && !force) {
      return new Response(
        JSON.stringify({
          skipped: true,
          reason: `Today (${currentDay}) is not the last day of the month (${daysInMonth}). Skipping reminder.`,
          current_wat_date: nowWat.toISOString().split("T")[0],
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Helper: compute next First Tuesday from current WAT date
    function getNextFirstTuesday(watDate: Date): Date {
      const cur = new Date(watDate.getTime() + 24 * 3600_000);
      for (let i = 0; i < 35; i++) {
        const candidate = new Date(cur.getTime() + i * 24 * 3600_000);
        // getUTCDay: 0=Sun, 1=Mon, 2=Tue. First Tuesday of month is day 1 to 7.
        if (candidate.getUTCDay() === 2 && candidate.getUTCDate() <= 7) {
          return candidate;
        }
      }
      return cur;
    }

    const nextFirstTuesday = getNextFirstTuesday(nowWat);
    const formattedDate = nextFirstTuesday.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });

    const { data: upcomingActs } = await supabase
      .from("activities")
      .select("*")
      .gte("closes_at", nowUtc.toISOString())
      .is("finalized_at", null)
      .order("opens_at", { ascending: true })
      .limit(1);

    const targetActivity = upcomingActs && upcomingActs.length > 0 ? upcomingActs[0] : null;

    // 4. Fetch all instrumentalists with push tokens
    const { data: members, error: memErr } = await supabase
      .from("users")
      .select("id, name, phone, push_token")
      .in("role", ["member", "sub_admin"]);

    if (memErr) throw memErr;

    const memberList = members || [];
    const validTokens = memberList.filter(
      (m) => m.push_token && m.push_token.startsWith("ExponentPushToken[")
    );

    // 5. Construct notification message
    let notifTitle = "";
    let notifBody = "";

    if (reminderType === "morning") {
      notifTitle = "Church Cleaning & Sound Check Open";
      notifBody = "Good morning! Today's attendance session is now open at church HQ. Please arrive on time and verify attendance on arrival.";
    } else {
      notifTitle = "First Tuesday Cleaning Reminder";
      notifBody = `Instrument cleaning is on Tuesday, ${formattedDate}, at 6:00 AM. Please arrive on time with your instrument.`;
    }

    // 6. Send Push Notifications via Expo Push API in chunks of 100
    const pushMessages = validTokens.map((m) => ({
      to: m.push_token,
      sound: "default",
      title: notifTitle,
      body: `Hello ${m.name || "Musician"}, ${notifBody}`,
      data: {
        type: reminderType,
        activity_id: targetActivity?.id || null,
        url: "ggm://home",
      },
      priority: "high",
      channelId: "attendance-reminders",
    }));

    let pushSuccessCount = 0;
    if (pushMessages.length > 0) {
      const CHUNK_SIZE = 100;
      for (let i = 0; i < pushMessages.length; i += CHUNK_SIZE) {
        const chunk = pushMessages.slice(i, i + CHUNK_SIZE);
        try {
          const resp = await fetch("https://exp.host/--/api/v2/push/send", {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Accept-encoding": "gzip, deflate",
              "Content-Type": "application/json",
            },
            body: JSON.stringify(chunk),
          });
          const result = await resp.json();
          if (result.data) {
            pushSuccessCount += result.data.filter((r: any) => r.status === "ok").length;
          }
        } catch (pushErr) {
          console.error("Expo push notification batch error:", pushErr);
        }
      }
    }

    // 7. Store in-app notification rows in public.notifications table
    const inAppRows = memberList.map((m) => ({
      member_id: m.id,
      title: notifTitle,
      body: notifBody,
      type: "reminder",
    }));

    if (inAppRows.length > 0) {
      const { error: notifInsertErr } = await supabase
        .from("notifications")
        .insert(inAppRows);

      if (notifInsertErr) {
        console.warn("In-app notifications insert error:", notifInsertErr.message);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        type: reminderType,
        total_members: memberList.length,
        tokens_found: validTokens.length,
        push_sent: pushSuccessCount,
        in_app_created: inAppRows.length,
        activity_id: targetActivity?.id || null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("send-reminder error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err.message || "Failed to send reminders" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
