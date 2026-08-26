// Emails a user when their public.profiles row is approved.
// Called by the approval trigger in sql/notify_user_approved.sql.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const DAC_EMAIL_FROM = Deno.env.get("DAC_EMAIL_FROM") ?? "";
const PORTAL_URL = Deno.env.get("DAC_PORTAL_URL") ?? "https://samkelo-makeleni.github.io/dac_full_system/";
const APPROVAL_WEBHOOK_SECRET = Deno.env.get("APPROVAL_WEBHOOK_SECRET") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function roleLabel(role: string) {
  return role === "manager" ? "Manager" : "Team Lead";
}

function isFalcorpEmail(email: string) {
  return /^[^@\s]+@falcorp\.co\.za$/i.test(email);
}

function authorized(req: Request) {
  const authHeader = req.headers.get("Authorization") ?? "";
  const secretHeader = req.headers.get("x-webhook-secret") ?? "";
  return authHeader === `Bearer ${SERVICE_ROLE_KEY}` ||
    (!!APPROVAL_WEBHOOK_SECRET && secretHeader === APPROVAL_WEBHOOK_SECRET);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!authorized(req)) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    const { profileId, fullName, role } = await req.json();
    if (!profileId || !fullName || !["team_lead", "manager"].includes(role)) {
      return new Response(JSON.stringify({ ok: false, error: "Missing profileId/fullName/role" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(profileId);
    const email = userData?.user?.email ?? "";

    if (userError || !email) {
      return new Response(JSON.stringify({ ok: false, error: userError?.message ?? "User email not found" }), {
        status: 200,
        headers: corsHeaders,
      });
    }

    if (!isFalcorpEmail(email)) {
      return new Response(JSON.stringify({ ok: false, error: "User email is not a Falcorp address" }), {
        status: 200,
        headers: corsHeaders,
      });
    }

    if (!RESEND_API_KEY || !DAC_EMAIL_FROM) {
      return new Response(JSON.stringify({ ok: false, error: "DAC email is not configured" }), {
        status: 200,
        headers: corsHeaders,
      });
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: DAC_EMAIL_FROM,
        to: [email],
        subject: "Falcorp DAC Portal access approved",
        text:
          `Hi ${fullName},\n\nYour Falcorp DAC Portal access has been approved as ${roleLabel(role)}.\n\nYou can now sign in here:\n${PORTAL_URL}\n\nThanks,\nFalcorp DAC Portal`,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return new Response(JSON.stringify({ ok: false, error: `Approval email failed ${response.status}: ${errText}` }), {
        status: 200,
        headers: corsHeaders,
      });
    }

    return new Response(JSON.stringify({ ok: true, emailSent: true, emailedTo: email }), {
      headers: corsHeaders,
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
