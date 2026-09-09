import { createClient } from "npm:@supabase/supabase-js@2";
import {
  checkOpenAiApi,
  checkResendApi,
  checkSupabaseDatabase,
  sendMonitoringAlert,
  splitEmailList,
  summarizeChecks,
  type DependencyCheck,
} from "../_shared/monitoring.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

async function authorizeHealthCheck(req: Request, supabase: any) {
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearerToken = authHeader.replace(/^Bearer\s+/i, "");

  if (bearerToken === SERVICE_ROLE_KEY) return null;

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
    return new Response(JSON.stringify({ ok: false, error: "Only approved users can view system health" }), {
      status: 403,
      headers: corsHeaders,
    });
  }

  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const authResponse = await authorizeHealthCheck(req, supabase);
    if (authResponse) return authResponse;

    const checks: DependencyCheck[] = [
      await checkSupabaseDatabase(supabase),
      await checkResendApi(),
      await checkOpenAiApi(),
    ];

    const summary = summarizeChecks(checks);
    const status = summary.ok ? "healthy" : "degraded";

    let alertResult = { sent: false, reason: "No alert needed" };
    if (!summary.ok) {
      const recipients = splitEmailList(Deno.env.get("ALERT_EMAIL_TO") ?? Deno.env.get("DAC_MANAGER_EMAIL"));
      if (recipients.length > 0) {
        const subject = `[Falcorp DAC] System health alert: ${status}`;
        const body = [
          "The DAC system is reporting a dependency health problem.",
          "",
          ...checks.map((check) => `${check.name}: ${check.ok ? "OK" : "FAILED"} - ${check.detail}`),
          "",
          `Status: ${status}`,
        ].join("\n");

        alertResult = await sendMonitoringAlert(subject, body);
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        status,
        checks,
        summary,
        alertSent: alertResult.sent,
        alertReason: alertResult.reason,
      }),
      { status: summary.ok ? 200 : 503, headers: corsHeaders },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ ok: false, status: "error", error: message }),
      { status: 500, headers: corsHeaders },
    );
  }
});
