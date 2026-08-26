// supabase/functions/generate-dac/index.ts
//
// Runs automatically on the 1st of every month (see pg_cron setup in
// SETUP.md) and compiles the PREVIOUS calendar month's weekly reports
// into a finished DAC docx, uploaded to the 'generated-dacs' bucket.
//
// Can also be called manually (e.g. from the frontend "Generate now"
// button, or via curl) with a JSON body { "periodStart": "2026-08-01" }
// to regenerate a specific month on demand.
//
// Deploy with:
//   supabase functions deploy generate-dac --no-verify-jwt
// (no-verify-jwt because pg_cron calls it directly; browser calls are
// authorized inside this function using the user's Supabase JWT.)

import { createClient } from "npm:@supabase/supabase-js@2";
import { buildDac, DacData } from "../_shared/dac_template.ts";
import { writeMonthlyNarrative, PersonMonth } from "../_shared/write_narrative.ts";
import { DAC_CONFIG } from "../_shared/dac_config.ts";
import { parseWeeklyReportBuffer } from "../_shared/docx_parser.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const DAC_EMAIL_FROM = Deno.env.get("DAC_EMAIL_FROM") ?? "";
const DAC_MANAGER_EMAILS = (Deno.env.get("DAC_MANAGER_EMAIL") ?? "lrouxe1@telkom.co.za")
  .split(/[;,]/)
  .map((email) => email.trim())
  .filter(Boolean);
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const WEEKLY_ENTRY_COLUMNS =
  "id, activities, risks, knowledge_transfer, continuous_improvement, continuous_learning, ai_efficiency";

function uint8ArrayToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function emailDac(params: {
  reportingPeriod: string;
  fileName: string;
  docBytes: Uint8Array;
  recipients: string[];
}) {
  if (!RESEND_API_KEY) {
    return { sent: false, reason: "Missing RESEND_API_KEY secret for DAC email sending" };
  }
  if (!DAC_EMAIL_FROM) {
    return { sent: false, reason: "Missing DAC_EMAIL_FROM secret for DAC email sending" };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: DAC_EMAIL_FROM,
      to: params.recipients,
      subject: `Delivery Acceptance Certificate (DAC) - ${params.reportingPeriod}`,
      text:
        `Good day,\n\nPlease find attached the Delivery Acceptance Certificate (DAC) for ${params.reportingPeriod}.\n\nRegards,\nFalcorp DAC Portal`,
      attachments: [
        {
          filename: params.fileName,
          content: uint8ArrayToBase64(params.docBytes),
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`DAC email failed ${response.status}: ${errText}`);
  }

  return { sent: true, reason: null };
}

async function ensureReportParsed(supabase: any, report: any, forceReparse = false) {
  const existingEntry = Array.isArray(report.weekly_entries) ? report.weekly_entries[0] : report.weekly_entries;

  if (!forceReparse && report.parsed && existingEntry) {
    return { ok: true, entry: existingEntry, skipped: true };
  }

  const { data: fileData, error: downloadError } = await supabase
    .storage
    .from("weekly-reports")
    .download(report.storage_path);

  if (downloadError || !fileData) {
    const message = `download failed: ${downloadError?.message ?? "unknown"}`;
    await supabase.from("weekly_reports").update({ parse_error: message }).eq("id", report.id);
    return { ok: false, error: message };
  }

  try {
    const parsed = await parseWeeklyReportBuffer(await fileData.arrayBuffer(), report.storage_path);
    const parsedPersonName = parsed.name?.trim();
    const entry = {
      activities: parsed.activities,
      risks: parsed.risks,
      knowledge_transfer: parsed.knowledgeTransfer,
      continuous_improvement: parsed.continuousImprovement,
      continuous_learning: parsed.continuousLearning,
      ai_efficiency: parsed.aiEfficiency,
    };

    const query = existingEntry?.id
      ? supabase.from("weekly_entries").update(entry).eq("id", existingEntry.id)
      : supabase.from("weekly_entries").insert({ weekly_report_id: report.id, ...entry });

    const { data: savedEntry, error: saveError } = await query
      .select(WEEKLY_ENTRY_COLUMNS)
      .single();

    if (saveError) {
      const message = `${existingEntry?.id ? "update" : "insert"} failed: ${saveError.message}`;
      await supabase.from("weekly_reports").update({ parse_error: message }).eq("id", report.id);
      return { ok: false, error: message };
    }

    await supabase.from("weekly_reports").update({
      parsed: true,
      parse_error: null,
      ...(parsedPersonName ? { person_name: parsedPersonName } : {}),
    }).eq("id", report.id);
    report.parsed = true;
    if (parsedPersonName) report.person_name = parsedPersonName;
    report.weekly_entries = [savedEntry ?? entry];
    return { ok: true, entry: savedEntry ?? entry };
  } catch (err) {
    const message = String(err);
    await supabase.from("weekly_reports").update({ parse_error: message }).eq("id", report.id);
    return { ok: false, error: message };
  }
}

function monthBounds(periodStartOverride?: string) {
  const now = periodStartOverride ? new Date(periodStartOverride) : new Date();
  // Default: previous calendar month relative to "now"
  const year = periodStartOverride ? now.getUTCFullYear() : now.getUTCFullYear();
  const month = periodStartOverride ? now.getUTCMonth() : now.getUTCMonth() - 1;

  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 0)); // last day of that month

  const label = start.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return { start, end, label };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // --- Authorization ---
    // Allowed callers: (a) pg_cron, which calls with the service role key
    // in the Authorization header, or (b) a logged-in user with role
    // 'manager' or 'team_lead', identified via their own JWT (sent by the frontend).
    const authHeader = req.headers.get("Authorization") ?? "";
    const bearerToken = authHeader.replace(/^Bearer\s+/i, "");

    const isServiceRoleCall = bearerToken === SERVICE_ROLE_KEY;

    if (!isServiceRoleCall) {
      const { data: userData, error: userError } = await supabase.auth.getUser(bearerToken);
      if (userError || !userData?.user) {
        return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401, headers: corsHeaders });
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userData.user.id)
        .single();
      if (!profile || !["manager", "team_lead"].includes(profile.role)) {
        return new Response(JSON.stringify({ ok: false, error: "Only approved users can trigger DAC generation" }), { status: 403, headers: corsHeaders });
      }
    }

    let periodStartOverride: string | undefined;
    let forceReparse = false;
    try {
      const body = await req.json();
      periodStartOverride = body?.periodStart;
      forceReparse = body?.forceReparse === true;
    } catch {
      // no body — fine, use default (previous month)
    }

    const { start, end, label } = monthBounds(periodStartOverride);
    const startStr = start.toISOString().slice(0, 10);
    const endStr = end.toISOString().slice(0, 10);

    // 1. Pull all weekly reports whose week_start falls in this month,
    //    joined with their parsed entries.
    const { data: reports, error: reportsError } = await supabase
      .from("weekly_reports")
      .select(`
        id, person_name, week_start, storage_path, parsed, parse_error,
        weekly_entries ( ${WEEKLY_ENTRY_COLUMNS} )
      `)
      .gte("week_start", startStr)
      .lte("week_start", endStr);

    if (reportsError) throw reportsError;

    if (!reports || reports.length === 0) {
      return new Response(
        JSON.stringify({ ok: false, message: `No weekly reports found for ${label}` }),
        { status: 200, headers: corsHeaders },
      );
    }

    const parseFailures: any[] = [];
    for (const report of reports as any[]) {
      const parsedResult = await ensureReportParsed(supabase, report, forceReparse);
      if (!parsedResult.ok) {
        parseFailures.push({
          personName: report.person_name,
          weekStart: report.week_start,
          error: parsedResult.error,
        });
      }
    }

    if (parseFailures.length > 0) {
      return new Response(
        JSON.stringify({
          ok: false,
          message: `${parseFailures.length} weekly report(s) for ${label} could not be parsed. Check the report format or Edge Function logs, then try again.`,
          parseFailures,
        }),
        { status: 200, headers: corsHeaders },
      );
    }

    const pendingReports = (reports as any[]).filter((r) => {
      const entry = Array.isArray(r.weekly_entries) ? r.weekly_entries[0] : r.weekly_entries;
      return !r.parsed || !entry;
    });

    if (pendingReports.length > 0) {
      return new Response(
        JSON.stringify({
          ok: false,
          message: `${pendingReports.length} weekly report(s) for ${label} are still pending parsing. Generate the DAC after all reports show Parsed.`,
          pendingReports: pendingReports.map((r) => ({
            personName: r.person_name,
            weekStart: r.week_start,
          })),
        }),
        { status: 200, headers: corsHeaders },
      );
    }

    // 2. Group by person
    const byPerson = new Map<string, PersonMonth>();
    for (const r of reports as any[]) {
      const entry = Array.isArray(r.weekly_entries) ? r.weekly_entries[0] : r.weekly_entries;
      if (!entry) continue; // not parsed yet — skipped for this run
      if (!byPerson.has(r.person_name)) {
        byPerson.set(r.person_name, { name: r.person_name, weeks: [] });
      }
      byPerson.get(r.person_name)!.weeks.push({
        weekStart: r.week_start,
        activities: entry.activities ?? [],
        risks: entry.risks ?? [],
        knowledgeTransfer: entry.knowledge_transfer ?? [],
        continuousImprovement: entry.continuous_improvement ?? [],
        continuousLearning: entry.continuous_learning ?? [],
        aiEfficiency: entry.ai_efficiency ?? [],
      });
    }

    const peopleData = Array.from(byPerson.values());

    if (peopleData.length === 0) {
      return new Response(
        JSON.stringify({ ok: false, message: `No parsed weekly report entries found for ${label}` }),
        { status: 200, headers: corsHeaders },
      );
    }

    // 3. Build the narrative sections from the parsed raw data
    const sections = await writeMonthlyNarrative(label, peopleData);

    // 4. Assemble the full DAC data object
    const dacData: DacData = {
      ...DAC_CONFIG,
      reportingPeriod: label,
      sections,
    };

    // 5. Generate the docx
    const docBytes = await buildDac(dacData);

    // 6. Upload to storage
    const fileName = `DAC_TELCOM-IT_PM_-_${label.replace(/\s+/g, "_").toUpperCase()}.docx`;
    const storagePath = `${start.getUTCFullYear()}/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from("generated-dacs")
      .upload(storagePath, docBytes, {
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        upsert: true,
      });

    if (uploadError) throw uploadError;

    // 7. Record it. Regeneration replaces the stored file and updates the
    // existing month row instead of creating duplicates.
    const dacRecordPayload = {
      reporting_period: label,
      period_start: startStr,
      period_end: endStr,
      storage_path: storagePath,
      generated_by: "automated",
      generated_at: new Date().toISOString(),
    };

    const { data: existingDacs, error: existingDacsError } = await supabase
      .from("generated_dacs")
      .select("id")
      .eq("period_start", startStr)
      .limit(1);

    if (existingDacsError) throw existingDacsError;

    const existingDacId = existingDacs?.[0]?.id;
    const recordQuery = existingDacId
      ? supabase.from("generated_dacs").update(dacRecordPayload).eq("id", existingDacId)
      : supabase.from("generated_dacs").insert(dacRecordPayload);

    const { data: dacRecord, error: recordError } = await recordQuery
      .select("id")
      .single();

    if (recordError) throw recordError;

    // 8. Email the generated DAC to the manager
    const emailResult = await emailDac({
      reportingPeriod: label,
      fileName,
      docBytes,
      recipients: DAC_MANAGER_EMAILS,
    });

    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from("generated-dacs")
      .createSignedUrl(storagePath, 60 * 60);

    if (signedUrlError) throw signedUrlError;

    return new Response(
      JSON.stringify({
        ok: true,
        dacId: dacRecord?.id ?? null,
        reportingPeriod: label,
        storagePath,
        downloadUrl: signedUrlData?.signedUrl ?? null,
        emailSent: emailResult.sent,
        emailSkippedReason: emailResult.reason,
        emailedTo: DAC_MANAGER_EMAILS.join(", "),
        peopleIncluded: peopleData.map((p) => p.name),
      }),
      { headers: corsHeaders },
    );
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
