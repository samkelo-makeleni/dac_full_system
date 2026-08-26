// Deletes all weekly reports and their stored DOCX files.
// Managers only.

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

    if (profileError || !profile || profile.role !== "manager") {
      return new Response(JSON.stringify({ ok: false, error: "Only managers can delete all reports" }), {
        status: 403,
        headers: corsHeaders,
      });
    }

    const { data: reports, error: reportsError } = await supabase
      .from("weekly_reports")
      .select("id, storage_path");

    if (reportsError) {
      return new Response(JSON.stringify({ ok: false, error: `Report lookup failed: ${reportsError.message}` }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    const reportIds = (reports ?? []).map((report) => report.id).filter(Boolean);
    const storagePaths = Array.from(
      new Set((reports ?? []).map((report) => report.storage_path).filter(Boolean)),
    );

    if (storagePaths.length > 0) {
      const { error: storageError } = await supabase
        .storage
        .from("weekly-reports")
        .remove(storagePaths);

      if (storageError) {
        return new Response(JSON.stringify({ ok: false, error: `Storage delete failed: ${storageError.message}` }), {
          status: 500,
          headers: corsHeaders,
        });
      }
    }

    if (reportIds.length > 0) {
      const { error: deleteError } = await supabase
        .from("weekly_reports")
        .delete()
        .in("id", reportIds);

      if (deleteError) {
        return new Response(JSON.stringify({ ok: false, error: `Report delete failed: ${deleteError.message}` }), {
          status: 500,
          headers: corsHeaders,
        });
      }
    }

    return new Response(JSON.stringify({ ok: true, deletedReports: reportIds.length }), { headers: corsHeaders });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
