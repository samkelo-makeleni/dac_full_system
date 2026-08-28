// Approves a registered user and emails them.
// Only users with a manager profile can call this function.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const DAC_EMAIL_FROM = Deno.env.get("DAC_EMAIL_FROM") ?? "";
const PORTAL_URL = Deno.env.get("DAC_PORTAL_URL") ?? "https://samkelo-makeleni.github.io/dac_full_system/";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function roleLabel(role: string) {
  return role === "manager" ? "Manager" : "Team Lead";
}

function isFalcorpEmail(email: string) {
  return /^[^@\s]+@falcorp\.co\.za$/i.test(email);
}

async function emailApproval(params: { email: string; fullName: string; role: string }) {
  if (!RESEND_API_KEY || !DAC_EMAIL_FROM) {
    return { sent: false, reason: "DAC email is not configured" };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: DAC_EMAIL_FROM,
      to: [params.email],
      subject: "Falcorp DAC Portal access approved",
      text:
        `Hi ${params.fullName},\n\nYour Falcorp DAC Portal access has been approved as ${roleLabel(params.role)}.\n\nYou can now sign in here:\n${PORTAL_URL}\n\nThanks,\nFalcorp DAC Portal`,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    return { sent: false, reason: `Approval email failed ${response.status}: ${errText}` };
  }

  return { sent: true, reason: null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const bearerToken = authHeader.replace(/^Bearer\s+/i, "");
    const { profileId, fullName, role } = await req.json();

    if (!profileId || !fullName || !["team_lead", "manager"].includes(role)) {
      return new Response(JSON.stringify({ ok: false, error: "Missing profileId/fullName/role" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: callerData, error: callerError } = await supabase.auth.getUser(bearerToken);
    if (callerError || !callerData?.user) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    const { data: callerProfile, error: callerProfileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", callerData.user.id)
      .single();

    if (callerProfileError || callerProfile?.role !== "manager") {
      return new Response(JSON.stringify({ ok: false, error: "Only managers can approve users" }), {
        status: 403,
        headers: corsHeaders,
      });
    }

    const { data: targetUserData, error: targetUserError } = await supabase.auth.admin.getUserById(profileId);
    const email = targetUserData?.user?.email ?? "";

    if (targetUserError || !email) {
      return new Response(JSON.stringify({ ok: false, error: targetUserError?.message ?? "User email not found" }), {
        status: 404,
        headers: corsHeaders,
      });
    }

    if (!isFalcorpEmail(email)) {
      return new Response(JSON.stringify({ ok: false, error: "User email must end with @falcorp.co.za" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const { error: upsertError } = await supabase
      .from("profiles")
      .upsert({ id: profileId, full_name: fullName.trim(), role }, { onConflict: "id" });

    if (upsertError) {
      return new Response(JSON.stringify({ ok: false, error: upsertError.message }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    const emailResult = await emailApproval({ email, fullName: fullName.trim(), role });

    if (!emailResult.sent) {
      return new Response(JSON.stringify({
        ok: false,
        approved: true,
        approvedEmail: email,
        error: emailResult.reason,
      }), {
        status: 502,
        headers: corsHeaders,
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      approvedEmail: email,
      emailSent: emailResult.sent,
      emailSkippedReason: emailResult.reason,
    }), {
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
