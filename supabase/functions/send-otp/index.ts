// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { email } = await req.json();

    if (!email || !email.includes("@")) {
      return new Response(
        JSON.stringify({ success: false, error: "Valid email address is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Initialize Supabase Client with service role or env
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Check if user already exists
    const { data: existingUser } = await supabase
      .from("users")
      .select("id")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (existingUser) {
      return new Response(
        JSON.stringify({ success: false, error: "An account with this email already exists" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Rate limit: max 3 requests per email per 10 minutes
    const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { count: attemptCount } = await supabase
      .from("otp_codes")
      .select("*", { count: "exact", head: true })
      .eq("email", normalizedEmail)
      .gte("created_at", tenMinsAgo);

    if (attemptCount && attemptCount >= 3) {
      return new Response(
        JSON.stringify({ success: false, error: "Too many OTP requests. Please wait 10 minutes before retrying." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Generate 6-digit numeric code
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // 4. Save to otp_codes table
    const { error: insertError } = await supabase.from("otp_codes").insert({
      email: normalizedEmail,
      code: otpCode,
      purpose: "registration",
      expires_at: expiresAt,
    });

    if (insertError) throw insertError;

    // 5. Send email via Brevo API
    const brevoApiKey = Deno.env.get("BREVO_API_KEY");
    if (brevoApiKey) {
      const emailPayload = {
        sender: {
          name: "GGM Instrumentalists Department",
          email: "notifications@ggm.org.ng",
        },
        to: [{ email: normalizedEmail }],
        subject: "Your GGM Attendance Registration Code",
        htmlContent: `
          <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
            <h2 style="color: #4338ca; text-align: center; margin-bottom: 8px;">GGM Instrumentalists Department</h2>
            <p style="color: #64748b; text-align: center; font-size: 14px; margin-top: 0;">Registration Verification Code</p>
            <div style="background: #f1f5f9; padding: 18px; border-radius: 8px; text-align: center; margin: 24px 0;">
              <span style="font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #0f172a;">${otpCode}</span>
            </div>
            <p style="color: #334155; font-size: 14px; line-height: 1.5;">This code will expire in <strong>10 minutes</strong>. Enter it in the app to complete your account registration.</p>
            <p style="color: #94a3b8; font-size: 12px; margin-top: 24px; border-top: 1px solid #f1f5f9; padding-top: 12px; text-align: center;">If you did not request this code, please ignore this email.</p>
          </div>
        `,
      };

      const brevoResponse = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": brevoApiKey,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify(emailPayload),
      });

      if (!brevoResponse.ok) {
        const errText = await brevoResponse.text();
        console.warn("Brevo API note:", errText);
      }
    } else {
      console.log(`[DEV MODE] Brevo API key not set. OTP for ${normalizedEmail} is: ${otpCode}`);
    }

    return new Response(
      JSON.stringify({ success: true, message: "Verification code sent successfully" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
