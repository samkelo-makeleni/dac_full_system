// Builds the DAC narrative with OpenAI from parsed weekly-report rows.
// The parser is intentionally deterministic; this file is the writer layer.

export interface PersonMonth {
  name: string;
  weeks: {
    weekStart: string;
    activities: { day: string; project: string; hours: string; work: string; notes: string; details?: string[] }[];
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
const OPENAI_NARRATIVE_REQUIRED = "OPENAI_NARRATIVE_REQUIRED";

const REQUIRED_SECTION_TITLES = [
  "Monthly Synopsis of Achievements",
  "Project Delivery",
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
  return peopleData.map((person, index) => ({
    contributorRef: `Team member ${index + 1}`,
    weeks: person.weeks.map((week) => ({
      weekStart: clean(week.weekStart),
      activities: (week.activities ?? []).map((activity) => ({
        day: clean(activity.day),
        project: clean(activity.project),
        hours: clean(activity.hours),
        work: clean(activity.work),
        notes: clean(activity.notes),
        details: unique(activity.details ?? []),
      })).filter((activity) => activity.project || activity.work || activity.notes || activity.details.length),
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

function unique(values: string[]) {
  return Array.from(new Set(values.map(clean).filter(Boolean)));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function contributorNames(peopleData: PersonMonth[]) {
  const names = unique(peopleData.map((person) => person.name));
  const nameParts = names.flatMap((name) => name.split(/\s+/).filter((part) => part.length >= 3));
  return unique([...names, ...nameParts])
    .sort((a, b) => b.length - a.length);
}

function redactNamesFromText(text: string, names: string[]) {
  let output = text;
  for (const name of names) {
    output = output.replace(new RegExp(`\\b${escapeRegExp(name)}\\b`, "gi"), "the delivery team");
  }
  return clean(output);
}

function redactContributorNames(sections: DacSection[], peopleData: PersonMonth[]) {
  const names = contributorNames(peopleData);
  if (!names.length) return sections;

  return sections.map((section) => {
    if (section.type === "paragraph") {
      return { ...section, text: redactNamesFromText(section.text || "", names) };
    }
    if (section.type === "bulletsPlain") {
      return { ...section, items: (section.items || []).map((item) => redactNamesFromText(String(item), names)) };
    }
    return {
      ...section,
      items: (section.items || []).map((item: any) => ({
        lead: redactNamesFromText(item.lead, names),
        text: redactNamesFromText(item.text, names),
      })),
    };
  });
}

function rowText(row: string[]) {
  return clean(row.join(" - "));
}

function isTemplateInstruction(row: string[]) {
  const text = row.join(" ").toLowerCase().replace(/\s+/g, " ").trim();
  return text.includes("reporting key issues and risks early shows value") ||
    text.includes("include impact if not resolved") ||
    text.includes("briefly describe any improvements or innovations you contributed") ||
    text.includes("area may be process efficiency, client experience, team collaboration");
}

function uniqueRows(rows: string[][]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = row.map(clean).join("\u001f").toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sanitizePeopleData(peopleData: PersonMonth[]): PersonMonth[] {
  return peopleData.map((person) => ({
    ...person,
    weeks: person.weeks.map((week) => ({
      ...week,
      activities: Array.from(new Map(
        week.activities.map((activity) => [
          JSON.stringify(activity),
          activity,
        ]),
      ).values()),
      risks: uniqueRows((week.risks ?? []).filter((row) => !isTemplateInstruction(row))),
      knowledgeTransfer: uniqueRows(week.knowledgeTransfer ?? []),
      continuousImprovement: uniqueRows((week.continuousImprovement ?? []).filter((row) => !isTemplateInstruction(row))),
      continuousLearning: uniqueRows(week.continuousLearning ?? []),
      aiEfficiency: uniqueRows(week.aiEfficiency ?? []),
    })),
  }));
}

function noFormalItems(section: string, reportingPeriod: string): DacSection {
  return {
    title: section,
    type: "paragraph",
    text: `No formal ${section.toLowerCase()} items were logged in the parsed weekly reports for ${reportingPeriod}.`,
  };
}

function buildFallbackNarrative(reportingPeriod: string, peopleData: PersonMonth[]): DacSection[] {
  const stats = sourceStats(peopleData);
  const weekStarts = unique(peopleData.flatMap((person) => person.weeks.map((week) => week.weekStart))).sort();
  const activities = peopleData.flatMap((person) =>
    person.weeks.flatMap((week) =>
      (week.activities ?? []).map((activity) => ({
          weekStart: clean(week.weekStart),
          project: clean(activity.project),
          work: clean([
            activity.work,
            activity.notes,
            ...(activity.details ?? []),
          ].filter(Boolean).join(" - ")),
        }))
    )
  ).filter((activity) => activity.project || activity.work);
  const projects = unique(activities.map((activity) => activity.project || "General delivery"));

  function activityItemsByProject() {
    if (!activities.length) {
      return [{ lead: "Delivery activity", text: "No project activity rows were available in the parsed weekly reports." }];
    }

    return projects.slice(0, 8).map((project) => {
      const related = activities.filter((activity) => (activity.project || "General delivery") === project);
      const weeks = unique(related.map((activity) => activity.weekStart)).sort();
      const workItems = unique(related.map((activity) => activity.work)).slice(0, 8);
      return {
        lead: project,
        text: [
          weeks.length ? `Weeks: ${weeks.join(", ")}.` : "",
          workItems.length ? workItems.join("; ") : "Delivery activity was recorded in the parsed weekly reports.",
        ].filter(Boolean).join(" "),
      };
    });
  }

  function supportingSection(title: string, key: keyof PersonMonth["weeks"][number]): DacSection {
    const rows = peopleData.flatMap((person) =>
      person.weeks.flatMap((week) =>
        ((week[key] as string[][] | undefined) ?? []).map((row) => ({
          weekStart: clean(week.weekStart),
          text: rowText(row),
        }))
      )
    ).filter((item) => item.text);

    if (rows.length === 0) return noFormalItems(title, reportingPeriod);
    return {
      title,
      type: "bulletsLead",
      items: unique(rows.map((item) => [item.weekStart, item.text].filter(Boolean).join(" - ")))
        .slice(0, 10)
        .map((text, index) => ({
          lead: `${title} ${index + 1}`,
          text,
        })),
    };
  }

  return [
    {
      title: "Monthly Synopsis of Achievements",
      type: "paragraph",
      text:
        `For ${reportingPeriod}, the Falcorp delivery team submitted ${stats.weekCount} parsed weekly report(s), covering ${stats.activityCount} delivery activity item(s) and ${stats.supportingCount} supporting evidence item(s). This narrative was generated directly from the parsed weekly report data because OpenAI narrative generation was unavailable.`,
    },
    {
      title: "Project Delivery",
      type: "bulletsPlain",
      items: [
        "Account / Client: Telkom CSB IT",
        `Focus Areas: ${projects.length ? projects.slice(0, 8).join(", ") : "Delivery activity captured in weekly reports"}`,
        `Reporting Period: ${reportingPeriod}${weekStarts.length ? ` (${weekStarts[0]} to ${weekStarts[weekStarts.length - 1]})` : ""}`,
        "Delivery Team: Falcorp project delivery team",
      ],
    },
    {
      title: "Project Summary",
      type: "paragraph",
      text:
        `The reporting evidence shows delivery across ${projects.length ? projects.join(", ") : "the recorded project work"}. The detailed activities and supporting evidence below retain the source report content without additional interpretation.`,
    },
    {
      title: "Project Activities",
      type: "bulletsLead",
      items: activityItemsByProject(),
    },
    supportingSection("Issues and Risks Associated with Delivery", "risks"),
    supportingSection("Knowledge and Skill Transfer", "knowledgeTransfer"),
    supportingSection("Continuous Improvement and Value Add", "continuousImprovement"),
    supportingSection("Continuous Learning", "continuousLearning"),
    supportingSection("AI – Efficiency and Improvements", "aiEfficiency"),
  ];
}

function shouldRequireOpenAiNarrative() {
  return Deno.env.get(OPENAI_NARRATIVE_REQUIRED)?.toLowerCase() === "true";
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
    "Analyse all weekly reports, combine overlapping items, and write polished monthly DAC narrative like a human delivery manager.",
    "The DAC is for the full delivery team, not a single contributor.",
    "Do not mention individual contributor names anywhere in the DAC narrative.",
    "Do not write who did what. Group work by project, delivery theme, system area, or outcome instead of by person.",
    "Each section has a distinct purpose: Synopsis describes material monthly achievements and outcomes; Project Delivery contains account, focus areas, period, and team-level metadata; Project Summary gives a concise overall delivery conclusion; Project Activities contains the detailed work performed; evidence sections contain only their own source category.",
    "Avoid repetition across sections. Do not repeat report counts, reporting dates, project names, or activity details merely to fill a section. Refer to details in another section only when needed for clarity, and use materially different wording and purpose.",
    "Do not write mechanical count-summary bullets such as 'Analysed 5 project activities...'.",
    "Do not invent projects, dates, tools, risks, outcomes, people, or training that are not supported by the source data.",
    "If a section has no source rows, write a short plain paragraph saying no formal items were logged for that section in the reporting period.",
    "Retain all material delivery details from the reports: project codes/names, work performed, meetings, testing, defects, releases, blockers, outcomes, learning, and AI/tool usage.",
    "Group related activity rows into coherent DAC bullets with strong project or theme lead labels.",
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
    "- Project Delivery: bulletsPlain with Account / Client, Focus Areas, Reporting Period, and Delivery Team.",
    "- Project Summary: paragraph.",
    "- Project Activities: bulletsLead grouped by delivery theme/project, not one bullet per raw row unless needed.",
    "- Remaining evidence sections: paragraph only if the whole team has no source rows; otherwise bulletsLead grouped by topic/theme.",
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
  peopleData = sanitizePeopleData(peopleData);
  const apiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
  if (!apiKey) {
    if (!shouldRequireOpenAiNarrative()) {
      console.warn("Missing OPENAI_API_KEY secret; using deterministic DAC narrative fallback");
      return redactContributorNames(buildFallbackNarrative(reportingPeriod, peopleData), peopleData);
    }
    throw new Error("Missing OPENAI_API_KEY secret; DAC narrative generation requires OpenAI");
  }

  const model = Deno.env.get("OPENAI_MODEL") || DEFAULT_OPENAI_MODEL;
  try {
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

    return redactContributorNames(validateSections(parseModelJson(responseText)), peopleData);
  } catch (err) {
    if (shouldRequireOpenAiNarrative()) {
      throw err;
    }
    console.warn(`Using deterministic DAC narrative fallback: ${String(err)}`);
    return redactContributorNames(buildFallbackNarrative(reportingPeriod, peopleData), peopleData);
  }
}
