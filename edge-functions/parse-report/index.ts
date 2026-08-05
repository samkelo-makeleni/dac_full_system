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

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    // Database Webhook payload shape: { type: "INSERT", table, record, ... }
    const record = payload.record;
    if (!record?.id || !record?.storage_path) {
      return new Response(JSON.stringify({ error: "Missing record/storage_path" }), { status: 400 });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // 1. Download the file from the weekly-reports bucket
    const { data: fileData, error: downloadError } = await supabase
      .storage
      .from("weekly-reports")
      .download(record.storage_path);

    if (downloadError || !fileData) {
      await supabase
        .from("weekly_reports")
        .update({ parse_error: `download failed: ${downloadError?.message ?? "unknown"}` })
        .eq("id", record.id);
      return new Response(JSON.stringify({ error: "download failed" }), { status: 500 });
    }

    // 2. Parse it
    const buffer = await fileData.arrayBuffer();
    const parsed = await parseWeeklyReportBuffer(buffer, record.storage_path);

    // 3. Store structured entries
    const { error: insertError } = await supabase.from("weekly_entries").insert({
      weekly_report_id: record.id,
      activities: parsed.activities,
      risks: parsed.risks,
      knowledge_transfer: parsed.knowledgeTransfer,
      continuous_improvement: parsed.continuousImprovement,
      continuous_learning: parsed.continuousLearning,
      ai_efficiency: parsed.aiEfficiency,
    });

    if (insertError) {
      await supabase
        .from("weekly_reports")
        .update({ parse_error: `insert failed: ${insertError.message}` })
        .eq("id", record.id);
      return new Response(JSON.stringify({ error: "insert failed" }), { status: 500 });
    }

    // 4. Mark as parsed
    await supabase
      .from("weekly_reports")
      .update({ parsed: true, parse_error: null })
      .eq("id", record.id);

    return new Response(JSON.stringify({ ok: true, activities: parsed.activities.length }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
