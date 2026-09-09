export type DependencyCheck = {
  name: string;
  ok: boolean;
  detail: string;
};

export function splitEmailList(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function summarizeChecks(checks: DependencyCheck[]) {
  const failed = checks.filter((check) => !check.ok);
  return {
    ok: failed.length === 0,
    total: checks.length,
    failed: failed.length,
    failedNames: failed.map((check) => check.name),
  };
}

export async function checkSupabaseDatabase(supabase: any): Promise<DependencyCheck> {
  try {
    const { error } = await supabase.from("profiles").select("id").limit(1);
    if (error) throw error;
    return { name: "Supabase database", ok: true, detail: "Database query succeeded" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { name: "Supabase database", ok: false, detail: message };
  }
}

export async function checkOpenAiApi(): Promise<DependencyCheck> {
  const apiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
  if (!apiKey) {
    return { name: "OpenAI API", ok: false, detail: "Missing OPENAI_API_KEY secret" };
  }

  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      return {
        name: "OpenAI API",
        ok: false,
        detail: `HTTP ${response.status}: ${body || response.statusText}`,
      };
    }

    return { name: "OpenAI API", ok: true, detail: "Models endpoint responded successfully" };
  } catch (error) {
    return {
      name: "OpenAI API",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function checkResendApi(): Promise<DependencyCheck> {
  const apiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  if (!apiKey) {
    return { name: "Resend email", ok: false, detail: "Missing RESEND_API_KEY secret" };
  }

  try {
    const response = await fetch("https://api.resend.com/domains", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const body = await response.text();
      return {
        name: "Resend email",
        ok: false,
        detail: `HTTP ${response.status}: ${body || response.statusText}`,
      };
    }

    return { name: "Resend email", ok: true, detail: "Resend API responded successfully" };
  } catch (error) {
    return {
      name: "Resend email",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function sendMonitoringAlert(subject: string, body: string) {
  const apiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const fromAddress = Deno.env.get("DAC_EMAIL_FROM") ?? "";
  const recipients = splitEmailList(Deno.env.get("ALERT_EMAIL_TO") ?? Deno.env.get("DAC_MANAGER_EMAIL"));

  if (!apiKey || !fromAddress || recipients.length === 0) {
    return { sent: false, reason: "Missing Resend configuration or ALERT_EMAIL_TO recipients" };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress,
        to: recipients,
        subject,
        text: body,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        sent: false,
        reason: `Resend error ${response.status}: ${text || response.statusText}`,
      };
    }

    return { sent: true, reason: null };
  } catch (error) {
    return {
      sent: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
