// Deletes a generated DAC record and its stored DOCX.
// Managers and team leads can delete generated DACs.

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
    const { dacId } = await req.json();

    if (!dacId) {
      return new Response(JSON.stringify({ ok: false, error: "Missing dacId" }), {
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

    if (profileError || !profile || !["manager", "team_lead"].includes(profile.role)) {
      return new Response(JSON.stringify({ ok: false, error: "Only managers and team leads can delete generated DACs" }), {
        status: 403,
        headers: corsHeaders,
      });
    }

    const { data: dac, error: dacError } = await supabase
      .from("generated_dacs")
      .select("id, storage_path")
      .eq("id", dacId)
      .single();

    if (dacError || !dac) {
      return new Response(JSON.stringify({ ok: false, error: "Generated DAC not found" }), {
        status: 404,
        headers: corsHeaders,
      });
    }

    const { error: storageError } = await supabase.storage
      .from("generated-dacs")
      .remove([dac.storage_path]);

    if (storageError) {
      return new Response(JSON.stringify({ ok: false, error: `Storage delete failed: ${storageError.message}` }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    const { error: deleteError } = await supabase
      .from("generated_dacs")
      .delete()
      .eq("id", dac.id);

    if (deleteError) {
      return new Response(JSON.stringify({ ok: false, error: `DAC delete failed: ${deleteError.message}` }), {
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
