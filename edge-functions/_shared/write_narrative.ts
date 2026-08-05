// Builds the DAC narrative with OpenAI from parsed weekly-report rows.
// The parser is intentionally deterministic; this file is the writer layer.

export interface PersonMonth {
  name: string;
  weeks: {
    weekStart: string;
    activities: { day: string; project: string; hours: string; work: string; notes: string }[];
    risks: string[][];
    knowledgeTransfer: string[][];
    continuousImprovement: string[][];
    continuousLearning: string[][];
    aiEfficiency: string[][];
  }[];
}

export interface DacSection {
  title: string;
  type: "paragraph" | "bulletsPlain" | "bulletsLead";
  text?: string;
  items?: (string | { lead: string; text: string })[];
}

const OPENAI_RESPONSES_API_URL = "https://api.openai.com/v1/responses";
const DEFAULT_OPENAI_MODEL = "gpt-5";

const REQUIRED_SECTION_TITLES = [
  "Monthly Synopsis of Achievements",
  "Project Delivery",
  "Project Team",
  "Project Summary",
  "Project Activities",
  "Issues and Risks Associated with Delivery",
  "Knowledge and Skill Transfer",
  "Continuous Improvement and Value Add",
  "Continuous Learning",
  "AI – Efficiency and Improvements",
];

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function compactPeopleData(peopleData: PersonMonth[]) {
  return peopleData.map((person) => ({
    name: clean(person.name),
    weeks: person.weeks.map((week) => ({
      weekStart: clean(week.weekStart),
      activities: (week.activities ?? []).map((activity) => ({
        day: clean(activity.day),
        project: clean(activity.project),
        hours: clean(activity.hours),
        work: clean(activity.work),
        notes: clean(activity.notes),
      })).filter((activity) => activity.project || activity.work || activity.notes),
      risks: cleanRows(week.risks),
      knowledgeTransfer: cleanRows(week.knowledgeTransfer),
      continuousImprovement: cleanRows(week.continuousImprovement),
      continuousLearning: cleanRows(week.continuousLearning),
      aiEfficiency: cleanRows(week.aiEfficiency),
    })),
  }));
}

function cleanRows(rows: string[][] | undefined) {
  return (rows ?? [])
    .map((row) => row.map(clean).filter(Boolean))
    .filter((row) => row.length > 0);
}

function sourceStats(peopleData: PersonMonth[]) {
  const weekCount = peopleData.reduce((total, person) => total + person.weeks.length, 0);
  const activityCount = peopleData.reduce(
    (total, person) => total + person.weeks.reduce((sum, week) => sum + (week.activities?.length ?? 0), 0),
    0,
  );
  const supportingCount = peopleData.reduce(
    (total, person) =>
      total + person.weeks.reduce(
        (sum, week) =>
          sum +
          (week.risks?.length ?? 0) +
          (week.knowledgeTransfer?.length ?? 0) +
          (week.continuousImprovement?.length ?? 0) +
          (week.continuousLearning?.length ?? 0) +
          (week.aiEfficiency?.length ?? 0),
        0,
      ),
    0,
  );
  return { peopleCount: peopleData.length, weekCount, activityCount, supportingCount };
}

function buildPrompt(reportingPeriod: string, peopleData: PersonMonth[]) {
  const payload = {
    reportingPeriod,
    reportStats: sourceStats(peopleData),
    peopleData: compactPeopleData(peopleData),
  };

  return [
    "You are writing a Falcorp / Telkom CSB Delivery Acceptance Certificate (DAC).",
    "",
    "Use the supplied parsed weekly delivery reports as the only source of truth.",
    "Analyse each person's weekly reports, combine overlapping items, and write polished monthly DAC narrative like a human delivery manager.",
    "Do not write mechanical count-summary bullets such as 'Analysed 5 project activities...'.",
    "Do not invent projects, dates, tools, risks, outcomes, people, or training that are not supported by the source data.",
    "If a section has no source rows, write a short plain paragraph saying no formal items were logged for that section in the reporting period.",
    "Retain all material details from the reports: project codes/names, work performed, meetings, testing, defects, releases, blockers, outcomes, learning, AI/tool usage, and named contributors.",
    "Group related activity rows into coherent DAC bullets with strong lead labels. Mention contributors in the lead or body when useful.",
    "Keep the language professional and close to the manual DAC examples: concise, specific, delivery-focused, and outcome-oriented.",
    "",
    "Return ONLY valid JSON. No markdown, no code fences, no commentary.",
    "The JSON must be an array of section objects matching this TypeScript union:",
    `{ "title": string, "type": "paragraph", "text": string }`,
    `{ "title": string, "type": "bulletsPlain", "items": string[] }`,
    `{ "title": string, "type": "bulletsLead", "items": { "lead": string, "text": string }[] }`,
    "",
    "Return these exact section titles, in this exact order:",
    ...REQUIRED_SECTION_TITLES.map((title) => `- ${title}`),
    "",
    "Formatting rules:",
    "- Monthly Synopsis of Achievements: paragraph.",
    "- Project Delivery: bulletsPlain with Account / Client, Focus Areas, Reporting Period, and Contributors.",
    "- Project Team: bulletsLead by contributor or role/practice if evident.",
    "- Project Summary: paragraph.",
    "- Project Activities: bulletsLead grouped by delivery theme/project, not one bullet per raw row unless needed.",
    "- Remaining evidence sections: paragraph if empty, otherwise bulletsLead.",
    "- Do not include a Weekly Report Analysis section.",
    "- Keep bullet text complete enough that a reviewer can see what was delivered, but avoid raw table dumping.",
    "",
    "Parsed report data:",
    JSON.stringify(payload),
  ].join("\n");
}

function extractResponseText(responseJson: any): string {
  if (typeof responseJson?.output_text === "string") {
    return responseJson.output_text.trim();
  }

  const chunks: string[] = [];
  for (const output of responseJson?.output ?? []) {
    for (const content of output?.content ?? []) {
      if (typeof content?.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("\n").trim();
}

function parseModelJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = /\[[\s\S]*\]/.exec(trimmed);
    if (!match) throw new Error("OpenAI response did not contain a JSON array");
    return JSON.parse(match[0]);
  }
}

function validateSections(value: unknown): DacSection[] {
  if (!Array.isArray(value)) throw new Error("OpenAI response JSON was not an array");

  const sections = value.map((section, index) => {
    if (!section || typeof section !== "object") {
      throw new Error(`OpenAI section ${index + 1} was not an object`);
    }
    const raw = section as Record<string, any>;
    const title = clean(raw.title);
    const type = raw.type;
    if (!REQUIRED_SECTION_TITLES.includes(title)) {
      throw new Error(`OpenAI returned unexpected DAC section title: ${title || "(blank)"}`);
    }
    if (!["paragraph", "bulletsPlain", "bulletsLead"].includes(type)) {
      throw new Error(`OpenAI returned invalid section type for ${title}: ${type}`);
    }

    if (type === "paragraph") {
      const text = clean(raw.text);
      if (!text) throw new Error(`OpenAI returned empty paragraph section: ${title}`);
      return { title, type, text };
    }

    if (!Array.isArray(raw.items) || raw.items.length === 0) {
      throw new Error(`OpenAI returned empty bullet section: ${title}`);
    }

    if (type === "bulletsPlain") {
      return {
        title,
        type,
        items: raw.items.map((item: unknown) => clean(item)).filter(Boolean),
      };
    }

    return {
      title,
      type,
      items: raw.items.map((item: any) => ({
        lead: clean(item?.lead),
        text: clean(item?.text),
      })).filter((item: { lead: string; text: string }) => item.lead && item.text),
    };
  });

  const missing = REQUIRED_SECTION_TITLES.filter((title) => !sections.some((section) => section.title === title));
  if (missing.length) throw new Error(`OpenAI response omitted DAC section(s): ${missing.join(", ")}`);

  return REQUIRED_SECTION_TITLES.map((title) => sections.find((section) => section.title === title)!);
}

export async function writeMonthlyNarrative(
  reportingPeriod: string,
  peopleData: PersonMonth[],
): Promise<DacSection[]> {
  const apiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY secret; DAC narrative generation requires OpenAI");
  }

  const model = Deno.env.get("OPENAI_MODEL") || DEFAULT_OPENAI_MODEL;
  const response = await fetch(OPENAI_RESPONSES_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_output_tokens: 12000,
      input: [
        {
          role: "system",
          content:
            "You write polished monthly DAC reports from structured weekly delivery data. You are precise, source-grounded, and return only valid JSON.",
        },
        {
          role: "user",
          content: buildPrompt(reportingPeriod, peopleData),
        },
      ],
    }),
  });

  const requestId = response.headers.get("x-request-id") ?? "";
  const responseJson = await response.json().catch(() => null);
  if (!response.ok) {
    const message = responseJson?.error?.message || response.statusText || "unknown OpenAI API error";
    const suffix = requestId ? ` request-id: ${requestId}` : "";
    throw new Error(`OpenAI narrative generation failed (${response.status}): ${message}.${suffix}`);
  }

  const responseText = extractResponseText(responseJson);
  if (!responseText) throw new Error("OpenAI returned an empty narrative response");

  return validateSections(parseModelJson(responseText));
}
