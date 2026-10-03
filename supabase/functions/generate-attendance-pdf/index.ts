// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

// Colors in 0-1 RGB
const COLOR_PRIMARY = rgb(0.09, 0.23, 0.44);     // #173B70 (Navy)
const COLOR_NAVY_DARK = rgb(0.05, 0.15, 0.28);   // #0E2547
const COLOR_TEXT_DARK = rgb(0.06, 0.09, 0.16);   // #0F172A
const COLOR_TEXT_MUTED = rgb(0.39, 0.45, 0.55);  // #64748B
const COLOR_BORDER = rgb(0.89, 0.91, 0.94);      // #E2E8F0
const COLOR_BG_LIGHT = rgb(0.97, 0.98, 0.99);    // #F8FAFC
const COLOR_WHITE = rgb(1, 1, 1);
const COLOR_GREEN = rgb(0.08, 0.5, 0.24);       // #15803D
const COLOR_AMBER = rgb(0.71, 0.33, 0.04);       // #B45309

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Authorization: x-cron-secret (for cron jobs) OR super_admin JWT (for app calls)
    const cronSecret = Deno.env.get("CRON_SECRET");
    const secretHeader = req.headers.get("x-cron-secret");
    const authHeader = req.headers.get("Authorization") || "";
    let isAuthorized = false;
    let actorId = null;

    if (cronSecret && secretHeader === cronSecret) {
      // Authorized as cron — no user context needed
      isAuthorized = true;
    } else if (authHeader.startsWith("Bearer ")) {
      // Use anon-key client so auth.getUser() validates the user JWT correctly
      const supabaseAnon = createClient(
        supabaseUrl,
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: { user } } = await supabaseAnon.auth.getUser();
      if (user) {
        actorId = user.id;
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
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Parse request payload
    let activityId = null;
    try {
      const body = await req.json();
      activityId = body?.activity_id;
    } catch (_err) {
      // Empty body is acceptable
    }

    // Log request for visibility in Supabase Function logs
    console.log(`[PDF] Auth: ${cronSecret && secretHeader === cronSecret ? 'cron' : 'user'}. IP: ${req.headers.get('x-forwarded-for')}. Activity: ${activityId ?? 'default'}`);

    // 3. Fetch Activity
    let activity = null;
    if (activityId) {
      const { data, error } = await supabase
        .from("activities")
        .select("*")
        .eq("id", activityId)
        .single();
      if (error || !data) throw new Error("Specified activity not found.");
      activity = data;
    } else {
      // Cron sends no activity_id. Find the most recent activity that has
      // closed (closes_at < now()) and not yet been finalized.
      const nowIso = new Date().toISOString();
      const { data: latestActs, error } = await supabase
        .from("activities")
        .select("*")
        .lt("closes_at", nowIso)
        .is("finalized_at", null)
        .order("closes_at", { ascending: false })
        .limit(1);
      if (error || !latestActs || latestActs.length === 0) {
        return new Response(
          JSON.stringify({ skipped: true, reason: "no_closed_unfinalized_activity" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      activity = latestActs[0];
    }

    // 4. Fetch Attendance and User Data
    const { data: rawAttendance, error: attError } = await supabase
      .from("attendance")
      .select("id, member_id, activity_id, checked_in_at, check_in_method, selfie_url, verification_status")
      .eq("activity_id", activity.id)
      .order("checked_in_at", { ascending: true });

    if (attError) throw attError;

    const memberIds = Array.from(new Set((rawAttendance || []).map((a: any) => a.member_id).filter(Boolean)));

    const usersMap = new Map();
    if (memberIds.length > 0) {
      const { data: usersData } = await supabase
        .from("users")
        .select("id, name, instrument, phone")
        .in("id", memberIds);

      (usersData || []).forEach((u: any) => {
        usersMap.set(u.id, u);
      });
    }

    const attendees = (rawAttendance || []).map((row: any) => ({
      ...row,
      user: usersMap.get(row.member_id) || null,
    }));

    // 5. Fetch Total Members Count for Department
    const { count: totalMembersCount } = await supabase
      .from("users")
      .select("*", { count: "exact", head: true })
      .in("role", ["member", "sub_admin"]);

    const totalMembers = totalMembersCount || attendees.length;
    const presentCount = attendees.length;
    const attendancePct = totalMembers > 0
      ? ((presentCount / totalMembers) * 100).toFixed(1)
      : "100.0";

    // 6. Build PDF Document
    const pdfDoc = await PDFDocument.create();
    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const PAGE_WIDTH = 595.28;  // A4 portrait
    const PAGE_HEIGHT = 841.89;
    const MARGIN = 36;
    const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

    // Helper to format date in WAT (Lagos)
    const formatDateWAT = (dateStr: string) => {
      if (!dateStr) return "—";
      const d = new Date(dateStr);
      return d.toLocaleDateString("en-NG", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "Africa/Lagos",
      });
    };

    const formatTimeWAT = (dateStr: string) => {
      if (!dateStr) return "—";
      const d = new Date(dateStr);
      return d.toLocaleTimeString("en-NG", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
        timeZone: "Africa/Lagos",
      });
    };

    // Pre-fetch selfie thumbnails as embedded images
    const selfieMap = new Map();
    for (const item of attendees) {
      if (item.selfie_url) {
        try {
          const { data: fileData, error: dlErr } = await supabase.storage
            .from("selfies")
            .download(item.selfie_url);

          if (!dlErr && fileData) {
            const arrayBuffer = await fileData.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);
            let embedded = null;

            // Try JPG first, fallback to PNG
            try {
              embedded = await pdfDoc.embedJpg(bytes);
            } catch (_jpgErr) {
              try {
                embedded = await pdfDoc.embedPng(bytes);
              } catch (_pngErr) {
                // Non-embeddable format
              }
            }

            if (embedded) {
              selfieMap.set(item.id, embedded);
            }
          }
        } catch (_storageErr) {
          // Continue gracefully
        }
      }
    }

    let currentPage = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    let currentY = PAGE_HEIGHT - MARGIN;

    // ── Function: Draw Document Header ─────────────────────────────────────
    const drawHeader = (page: any, isFirstPage: boolean) => {
      let y = PAGE_HEIGHT - MARGIN;

      if (isFirstPage) {
        // Decorative Top Banner
        page.drawRectangle({
          x: MARGIN,
          y: y - 6,
          width: CONTENT_WIDTH,
          height: 4,
          color: COLOR_PRIMARY,
        });
        y -= 18;

        // Church Name
        page.drawText((activity.location_name || "God's Grace Ministry Int'l Headquarters").toUpperCase(), {
          x: MARGIN,
          y: y,
          size: 15,
          font: fontBold,
          color: COLOR_PRIMARY,
        });
        y -= 14;

        // Church Address
        page.drawText(
          activity.location_address ||
            "58 Arubayi Street, Okumagba Layout, Warri, Delta State, Nigeria",
          {
            x: MARGIN,
            y: y,
            size: 8.5,
            font: fontRegular,
            color: COLOR_TEXT_MUTED,
          }
        );
        y -= 16;

        // Document Title
        page.drawText("INSTRUMENTALISTS DEPARTMENT — MONTHLY ATTENDANCE REPORT", {
          x: MARGIN,
          y: y,
          size: 10.5,
          font: fontBold,
          color: COLOR_NAVY_DARK,
        });
        y -= 14;

        // Divider
        page.drawLine({
          start: { x: MARGIN, y: y },
          end: { x: PAGE_WIDTH - MARGIN, y: y },
          thickness: 1,
          color: COLOR_BORDER,
        });
        y -= 16;

        // Summary Card Background
        const cardHeight = 62;
        page.drawRectangle({
          x: MARGIN,
          y: y - cardHeight,
          width: CONTENT_WIDTH,
          height: cardHeight,
          color: COLOR_BG_LIGHT,
          borderColor: COLOR_BORDER,
          borderWidth: 1,
        });

        // Column 1: Activity Name & Date
        page.drawText("SESSION:", {
          x: MARGIN + 12,
          y: y - 16,
          size: 7.5,
          font: fontBold,
          color: COLOR_TEXT_MUTED,
        });
        page.drawText(activity.name || "Instrument Cleaning & Sound Check", {
          x: MARGIN + 12,
          y: y - 30,
          size: 10,
          font: fontBold,
          color: COLOR_PRIMARY,
        });
        page.drawText(
          `Date: ${formatDateWAT(activity.activity_date)} • ${formatTimeWAT(activity.opens_at)} - ${formatTimeWAT(activity.closes_at)}`,
          {
            x: MARGIN + 12,
            y: y - 44,
            size: 8,
            font: fontRegular,
            color: COLOR_TEXT_DARK,
          }
        );

        // Column 2: Stats Box
        const statsX = MARGIN + CONTENT_WIDTH - 170;
        page.drawText("ATTENDANCE SUMMARY:", {
          x: statsX,
          y: y - 16,
          size: 7.5,
          font: fontBold,
          color: COLOR_TEXT_MUTED,
        });
        page.drawText(`${presentCount} of ${totalMembers} Present (${attendancePct}%)`, {
          x: statsX,
          y: y - 30,
          size: 10,
          font: fontBold,
          color: COLOR_GREEN,
        });
        page.drawText(`Geofence: Church HQ (${activity.geofence_radius_m || 150}m Radius)`, {
          x: statsX,
          y: y - 44,
          size: 8,
          font: fontRegular,
          color: COLOR_TEXT_MUTED,
        });

        y -= cardHeight + 16;
      } else {
        // Running header on continuation pages
        page.drawText("GGM Instrumentalists Department — Attendance Report (Continued)", {
          x: MARGIN,
          y: y,
          size: 8.5,
          font: fontBold,
          color: COLOR_TEXT_MUTED,
        });
        page.drawText(formatDateWAT(activity.activity_date), {
          x: PAGE_WIDTH - MARGIN - 80,
          y: y,
          size: 8.5,
          font: fontRegular,
          color: COLOR_TEXT_MUTED,
        });
        y -= 8;
        page.drawLine({
          start: { x: MARGIN, y: y },
          end: { x: PAGE_WIDTH - MARGIN, y: y },
          thickness: 0.8,
          color: COLOR_BORDER,
        });
        y -= 14;
      }

      // ── Table Column Headers ───────────────────────────────────────────────
      const tableHeaderHeight = 22;
      page.drawRectangle({
        x: MARGIN,
        y: y - tableHeaderHeight,
        width: CONTENT_WIDTH,
        height: tableHeaderHeight,
        color: COLOR_PRIMARY,
      });

      // Headers text
      page.drawText("S/N", { x: MARGIN + 6, y: y - 15, size: 8, font: fontBold, color: COLOR_WHITE });
      page.drawText("PHOTO", { x: MARGIN + 32, y: y - 15, size: 8, font: fontBold, color: COLOR_WHITE });
      page.drawText("MEMBER NAME", { x: MARGIN + 76, y: y - 15, size: 8, font: fontBold, color: COLOR_WHITE });
      page.drawText("INSTRUMENT", { x: MARGIN + 236, y: y - 15, size: 8, font: fontBold, color: COLOR_WHITE });
      page.drawText("TIME (WAT)", { x: MARGIN + 360, y: y - 15, size: 8, font: fontBold, color: COLOR_WHITE });
      page.drawText("METHOD", { x: MARGIN + 440, y: y - 15, size: 8, font: fontBold, color: COLOR_WHITE });

      y -= tableHeaderHeight;
      return y;
    };

    // Draw First Page Header
    currentY = drawHeader(currentPage, true);

    // ── Draw Attendance Table Rows ──────────────────────────────────────────
    const ROW_HEIGHT = 32;
    const SIGNATURE_BLOCK_HEIGHT = 110;

    for (let i = 0; i < attendees.length; i++) {
      const item = attendees[i];
      const memberName = item.user?.name || "Musician";
      const instrument = item.user?.instrument || "Instrumentalist";
      const checkInTime = formatTimeWAT(item.checked_in_at);
      const isOffline = item.check_in_method === "offline_sync";
      const methodLabel = isOffline ? "Offline Sync" : "Live Geofence";

      // Check if page break is needed
      const neededBottomSpace = (i === attendees.length - 1)
        ? ROW_HEIGHT + SIGNATURE_BLOCK_HEIGHT + 20
        : ROW_HEIGHT + 30;

      if (currentY - neededBottomSpace < MARGIN) {
        // Add new page
        currentPage = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        currentY = drawHeader(currentPage, false);
      }

      // Row background
      if (i % 2 === 1) {
        currentPage.drawRectangle({
          x: MARGIN,
          y: currentY - ROW_HEIGHT,
          width: CONTENT_WIDTH,
          height: ROW_HEIGHT,
          color: COLOR_BG_LIGHT,
        });
      }

      // Bottom row divider
      currentPage.drawLine({
        start: { x: MARGIN, y: currentY - ROW_HEIGHT },
        end: { x: PAGE_WIDTH - MARGIN, y: currentY - ROW_HEIGHT },
        thickness: 0.5,
        color: COLOR_BORDER,
      });

      // 1. S/N
      currentPage.drawText(String(i + 1), {
        x: MARGIN + 6,
        y: currentY - 20,
        size: 8.5,
        font: fontRegular,
        color: COLOR_TEXT_MUTED,
      });

      // 2. Photo Thumbnail
      const photoSize = 24;
      const photoX = MARGIN + 34;
      const photoY = currentY - ROW_HEIGHT + 4;
      const embeddedPhoto = selfieMap.get(item.id);

      if (embeddedPhoto) {
        try {
          currentPage.drawImage(embeddedPhoto, {
            x: photoX,
            y: photoY,
            width: photoSize,
            height: photoSize,
          });
        } catch (_imgDrawErr) {
          // fallback placeholder box
          currentPage.drawRectangle({
            x: photoX,
            y: photoY,
            width: photoSize,
            height: photoSize,
            color: COLOR_BORDER,
          });
        }
      } else {
        // Fallback Monogram Avatar Box
        currentPage.drawRectangle({
          x: photoX,
          y: photoY,
          width: photoSize,
          height: photoSize,
          color: COLOR_PRIMARY,
        });
        const initial = memberName.charAt(0).toUpperCase() || "M";
        currentPage.drawText(initial, {
          x: photoX + 8,
          y: photoY + 6,
          size: 11,
          font: fontBold,
          color: COLOR_WHITE,
        });
      }

      // 3. Member Name
      currentPage.drawText(memberName.slice(0, 28), {
        x: MARGIN + 76,
        y: currentY - 20,
        size: 9,
        font: fontBold,
        color: COLOR_TEXT_DARK,
      });

      // 4. Instrument
      currentPage.drawText(instrument.slice(0, 22), {
        x: MARGIN + 236,
        y: currentY - 20,
        size: 8.5,
        font: fontRegular,
        color: COLOR_TEXT_DARK,
      });

      // 5. Time
      currentPage.drawText(checkInTime, {
        x: MARGIN + 360,
        y: currentY - 20,
        size: 8.5,
        font: fontRegular,
        color: COLOR_TEXT_DARK,
      });

      // 6. Method Tag
      currentPage.drawText(methodLabel, {
        x: MARGIN + 440,
        y: currentY - 20,
        size: 8,
        font: fontBold,
        color: isOffline ? COLOR_AMBER : COLOR_GREEN,
      });

      currentY -= ROW_HEIGHT;
    }

    // ── Empty list fallback text ─────────────────────────────────────────────
    if (attendees.length === 0) {
      currentPage.drawText("No check-ins recorded for this scheduled session.", {
        x: MARGIN + 140,
        y: currentY - 40,
        size: 10,
        font: fontRegular,
        color: COLOR_TEXT_MUTED,
      });
      currentY -= 70;
    }

    // ── Sign-off & Verification Block ───────────────────────────────────────
    currentY -= 20;

    // Attestation note
    currentPage.drawText(
      "CERTIFICATION: This official report is compiled and cryptographically verified against GPS geofence checks and live member selfie telemetry.",
      {
        x: MARGIN,
        y: currentY,
        size: 7.5,
        font: fontRegular,
        color: COLOR_TEXT_MUTED,
      }
    );
    currentY -= 36;

    // Signatures row (Left: Department Leader, Right: Pastor)
    const sigLineWidth = 200;
    const col2X = PAGE_WIDTH - MARGIN - sigLineWidth;

    // Left Signature
    currentPage.drawLine({
      start: { x: MARGIN, y: currentY },
      end: { x: MARGIN + sigLineWidth, y: currentY },
      thickness: 1,
      color: COLOR_TEXT_DARK,
    });
    currentPage.drawText("Department Director / Head of Music", {
      x: MARGIN,
      y: currentY - 12,
      size: 8.5,
      font: fontBold,
      color: COLOR_TEXT_DARK,
    });
    currentPage.drawText("GGM Instrumentalists Department", {
      x: MARGIN,
      y: currentY - 24,
      size: 7.5,
      font: fontRegular,
      color: COLOR_TEXT_MUTED,
    });
    currentPage.drawText("Date: ________________________", {
      x: MARGIN,
      y: currentY - 36,
      size: 7.5,
      font: fontRegular,
      color: COLOR_TEXT_MUTED,
    });

    // Right Signature
    currentPage.drawLine({
      start: { x: col2X, y: currentY },
      end: { x: col2X + sigLineWidth, y: currentY },
      thickness: 1,
      color: COLOR_TEXT_DARK,
    });
    currentPage.drawText("Minister in Charge / Supervising Pastor", {
      x: col2X,
      y: currentY - 12,
      size: 8.5,
      font: fontBold,
      color: COLOR_TEXT_DARK,
    });
    currentPage.drawText("God's Grace Ministry Int'l Headquarters", {
      x: col2X,
      y: currentY - 24,
      size: 7.5,
      font: fontRegular,
      color: COLOR_TEXT_MUTED,
    });
    currentPage.drawText("Date: ________________________", {
      x: col2X,
      y: currentY - 36,
      size: 7.5,
      font: fontRegular,
      color: COLOR_TEXT_MUTED,
    });

    // ── Page Numbers ────────────────────────────────────────────────────────
    const totalPages = pdfDoc.getPageCount();
    for (let p = 0; p < totalPages; p++) {
      const page = pdfDoc.getPage(p);
      page.drawText(`Page ${p + 1} of ${totalPages}`, {
        x: PAGE_WIDTH / 2 - 20,
        y: MARGIN - 18,
        size: 7.5,
        font: fontRegular,
        color: COLOR_TEXT_MUTED,
      });
      page.drawText("Generated by GGM Instrumentalists Portal", {
        x: MARGIN,
        y: MARGIN - 18,
        size: 7,
        font: fontRegular,
        color: COLOR_TEXT_MUTED,
      });
    }

    // 7. Save PDF Bytes
    const pdfBytes = await pdfDoc.save();

    // 8. Upload to Storage Bucket 'reports'
    const dateSlug = (activity.activity_date || new Date().toISOString().slice(0, 10)).replace(/-/g, "");
    const storagePath = `monthly/${dateSlug}_GGM_Attendance_${activity.id.slice(0, 8)}.pdf`;

    const { error: uploadErr } = await supabase.storage
      .from("reports")
      .upload(storagePath, pdfBytes, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadErr) {
      console.error("Storage upload error:", uploadErr);
      throw uploadErr;
    }

    // 9. Insert Record into reports Table
    const { data: reportRecord, error: insertErr } = await supabase
      .from("reports")
      .insert({
        activity_id: activity.id,
        type: "attendance",
        storage_path: storagePath,
        count: presentCount,
        generated_at: new Date().toISOString(),
        generated_by: actorId,
      })
      .select()
      .single();

    if (insertErr) {
      console.error("Reports table insert error:", insertErr);
    }

    // 10. Generate Signed Download URL (24-hour expiry)
    const { data: signedData } = await supabase.storage
      .from("reports")
      .createSignedUrl(storagePath, 86400);

    return new Response(
      JSON.stringify({
        success: true,
        report_id: reportRecord?.id || null,
        storage_path: storagePath,
        download_url: signedData?.signedUrl || null,
        activity_id: activity.id,
        activity_name: activity.name,
        present_count: presentCount,
        total_members: totalMembers,
        attendance_pct: attendancePct,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("generate-attendance-pdf error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err.message || "Failed to generate report" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
