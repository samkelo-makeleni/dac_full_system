// Deletes one weekly report and its stored DOCX after checking the caller's role.
// Managers can delete any report; team leads can delete only their own report.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const bearerToken = authHeader.replace(/^Bearer\s+/i, "");
    const { reportId } = await req.json();

    if (!reportId) {
      return new Response(JSON.stringify({ ok: false, error: "Missing reportId" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: userData, error: userError } = await supabase.auth.getUser(bearerToken);
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .single();

    if (profileError || !profile) {
      return new Response(JSON.stringify({ ok: false, error: "Profile not found" }), {
        status: 403,
        headers: corsHeaders,
      });
    }

    const { data: report, error: reportError } = await supabase
      .from("weekly_reports")
      .select("id, uploaded_by, storage_path")
      .eq("id", reportId)
      .single();

    if (reportError || !report) {
      return new Response(JSON.stringify({ ok: false, error: "Report not found" }), {
        status: 404,
        headers: corsHeaders,
      });
    }

    const canDelete = profile.role === "manager" || report.uploaded_by === userData.user.id;
    if (!canDelete) {
      return new Response(JSON.stringify({ ok: false, error: "You can only delete your own reports" }), {
        status: 403,
        headers: corsHeaders,
      });
    }

    const { error: storageError } = await supabase.storage
      .from("weekly-reports")
      .remove([report.storage_path]);

    if (storageError) {
      return new Response(JSON.stringify({ ok: false, error: `Storage delete failed: ${storageError.message}` }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    const { error: deleteError } = await supabase
      .from("weekly_reports")
      .delete()
      .eq("id", report.id);

    if (deleteError) {
      return new Response(JSON.stringify({ ok: false, error: `Report delete failed: ${deleteError.message}` }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
