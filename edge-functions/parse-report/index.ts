// supabase/functions/parse-report/index.ts
//
// Triggered via a Database Webhook (Database -> Webhooks) on
// INSERT into public.weekly_reports. Downloads the just-uploaded
// docx from storage, parses it, and writes the structured result
// into public.weekly_entries. Marks the report as parsed (or
// records a parse_error) so the frontend can show status.
//
// Deploy with:
//   supabase functions deploy parse-report --no-verify-jwt
// (no-verify-jwt because this is called by the DB webhook, not a user)

import { createClient } from "npm:@supabase/supabase-js@2";
import { parseWeeklyReportBuffer } from "../_shared/docx_parser.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("PARSE_REPORT_WEBHOOK_SECRET");
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

async function getAuthorizedReport(supabase: any, bearerToken: string, reportId: string) {
  const { data: userData, error: userError } = await supabase.auth.getUser(bearerToken);
  if (userError || !userData?.user) {
    return { response: new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401, headers: corsHeaders }) };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .single();

  if (profileError || !profile || !["manager", "team_lead"].includes(profile.role)) {
    return { response: new Response(JSON.stringify({ ok: false, error: "Only approved users can parse reports" }), { status: 403, headers: corsHeaders }) };
  }

  const { data: report, error: reportError } = await supabase
    .from("weekly_reports")
    .select("id, uploaded_by, storage_path")
    .eq("id", reportId)
    .single();

  if (reportError || !report) {
    return { response: new Response(JSON.stringify({ ok: false, error: "Report not found" }), { status: 404, headers: corsHeaders }) };
  }

  const canParse = profile.role === "manager" || report.uploaded_by === userData.user.id;
  if (!canParse) {
    return { response: new Response(JSON.stringify({ ok: false, error: "You can only parse your own reports" }), { status: 403, headers: corsHeaders }) };
  }

  return { report };
}

async function parseAndStoreReport(supabase: any, record: any) {
  const { data: fileData, error: downloadError } = await supabase
    .storage
    .from("weekly-reports")
    .download(record.storage_path);

  if (downloadError || !fileData) {
    await supabase
      .from("weekly_reports")
      .update({ parse_error: `download failed: ${downloadError?.message ?? "unknown"}` })
      .eq("id", record.id);
    return { ok: false, error: "download failed" };
  }

  const parsed = await parseWeeklyReportBuffer(await fileData.arrayBuffer(), record.storage_path);
  const parsedPersonName = parsed.name?.trim();
  const entry = {
    activities: parsed.activities,
    risks: parsed.risks,
    knowledge_transfer: parsed.knowledgeTransfer,
    continuous_improvement: parsed.continuousImprovement,
    continuous_learning: parsed.continuousLearning,
    ai_efficiency: parsed.aiEfficiency,
  };

  const { data: existingEntry, error: lookupError } = await supabase
    .from("weekly_entries")
    .select("id")
    .eq("weekly_report_id", record.id)
    .maybeSingle();

  if (lookupError && lookupError.code !== "PGRST116") {
    await supabase
      .from("weekly_reports")
      .update({ parse_error: `entry lookup failed: ${lookupError.message}` })
      .eq("id", record.id);
    return { ok: false, error: "entry lookup failed" };
  }

  const saveQuery = existingEntry?.id
    ? supabase.from("weekly_entries").update(entry).eq("id", existingEntry.id)
    : supabase.from("weekly_entries").insert({ weekly_report_id: record.id, ...entry });

  const { error: saveError } = await saveQuery;
  if (saveError) {
    await supabase
      .from("weekly_reports")
      .update({ parse_error: `save failed: ${saveError.message}` })
      .eq("id", record.id);
    return { ok: false, error: "save failed" };
  }

  await supabase
    .from("weekly_reports")
    .update({
      parsed: true,
      parse_error: null,
      ...(parsedPersonName ? { person_name: parsedPersonName } : {}),
    })
    .eq("id", record.id);

  return { ok: true, personName: parsedPersonName, activities: parsed.activities.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const payload = await req.json();
    let record = payload.record;

    if (!record && payload.reportId) {
      const authHeader = req.headers.get("Authorization") ?? "";
      const bearerToken = authHeader.replace(/^Bearer\s+/i, "");
      const result = await getAuthorizedReport(supabase, bearerToken, payload.reportId);
      if (result.response) return result.response;
      record = result.report;
    } else if (WEBHOOK_SECRET && req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    if (!record?.id || !record?.storage_path) {
      return new Response(JSON.stringify({ ok: false, error: "Missing record/storage_path" }), { status: 400, headers: corsHeaders });
    }

    const result = await parseAndStoreReport(supabase, record);
    const status = result.ok ? 200 : 500;

    return new Response(JSON.stringify(result), { status, headers: corsHeaders });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
