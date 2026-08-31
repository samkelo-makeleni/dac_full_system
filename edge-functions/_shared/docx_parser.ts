// Shared docx -> structured JSON parser for Supabase Edge Functions (Deno).
// Logic validated against real Falcorp weekly reports in a Node prototype
// before porting here — see /test/docx_parser_prototype.js in this repo
// for the original proof-of-concept and test run.
//
// Uses mammoth (via npm: specifier, supported by Supabase Edge Functions)
// to convert the .docx to HTML with heading styles preserved, then walks
// the resulting tables the same way the validated prototype does.

// deno-lint-ignore-file no-explicit-any
import mammoth from "npm:mammoth@1.7.2";
import { Buffer } from "node:buffer";

export interface Activity {
  day: string;
  project: string;
  hours: string;
  work: string;
  notes: string;
  details?: string[];
}

export interface ParsedWeeklyReport {
  sourceFile: string;
  name: string | null;
  weekStart: string | null;
  deliveryManager: string | null;
  activities: Activity[];
  risks: string[][];
  knowledgeTransfer: string[][];
  continuousImprovement: string[][];
  continuousLearning: string[][];
  aiEfficiency: string[][];
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHeading(text: string): string {
  return cleanHeading(text)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[–—]/g, "-")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanHeading(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function sectionAliases(headingText: string): string[] {
  const aliases: Record<string, string[]> = {
    "Project Activities": ["Project Activities", "Activities", "Project Activity"],
    "Project Risks/Issues": [
      "Project Risks/Issues",
      "Project Risks / Issues",
      "Project Risks and Issues",
      "Issues and Risks Associated with Delivery",
      "Risks and Issues",
      "Risks / Issues",
      "Risk and Issues",
    ],
    "Knowledge and Skill Transfer": ["Knowledge and Skill Transfer", "Knowledge Transfer", "Skill Transfer"],
    "Continuous Improvements and Value Add": [
      "Continuous Improvements and Value Add",
      "Continuous Improvement and Value Add",
      "Continuous Improvements and Value Adds",
      "Continuous Improvement and Value Adds",
      "Continuous Improvement",
      "Value Add",
      "Value Adds",
    ],
    "Continuous Learning": ["Continuous Learning", "Continual Learning", "Continued Learning", "Learning"],
    "AI & Efficiency Enhancements": [
      "AI & Efficiency Enhancements",
      "AI and Efficiency Enhancements",
      "AI Efficiency Enhancements",
      "AI - Efficiency and Improvements",
      "AI Efficiency and Improvements",
      "AI and Efficiency and Improvements",
      "AI - Efficiency Improvements",
      "AI & Efficiency Improvements",
      "AI and Efficiency Improvements",
      "AI Improvements",
      "Efficiency and Improvements",
    ],
  };
  return aliases[headingText] ?? [headingText];
}

const KNOWN_SECTION_TITLES = [
  "Project Activities",
  "Project Risks/Issues",
  "Knowledge and Skill Transfer",
  "Continuous Improvements and Value Add",
  "Continuous Learning",
  "AI & Efficiency Enhancements",
];

const KNOWN_SECTION_ALIASES = new Set(
  KNOWN_SECTION_TITLES.flatMap((title) => sectionAliases(title).map(normalizeHeading)),
);

function headingMatches(text: string, wanted: Set<string>): boolean {
  if (!text) return false;
  for (const candidate of wanted) {
    if (text === candidate || text.endsWith(candidate) || text.includes(candidate)) {
      return true;
    }
  }
  return false;
}

function isKnownSectionHeading(text: string): boolean {
  return headingMatches(text, KNOWN_SECTION_ALIASES);
}

function extractSectionTable(html: string, headingText: string): string | null {
  // Weekly reports sometimes convert section titles to <p><strong>...</strong></p>
  // instead of h1/h2. Walk block order and take the next table after a matching title.
  const wanted = new Set(sectionAliases(headingText).map(normalizeHeading));
  const blockRe = /<(h[12]|p|table)\b[^>]*>[\s\S]*?<\/\1>/gi;
  let foundHeading = false;
  let block: RegExpExecArray | null;

  while ((block = blockRe.exec(html))) {
    const tag = block[1].toLowerCase();
    const blockHtml = block[0];

    if (tag === "table") {
      if (foundHeading) return blockHtml;
      continue;
    }

    const text = normalizeHeading(stripTags(blockHtml));
    if (headingMatches(text, wanted)) {
      foundHeading = true;
    }
  }

  return null;
}

function extractSectionContent(html: string, headingText: string): string[] {
  const wanted = new Set(sectionAliases(headingText).map(normalizeHeading));
  const blockRe = /<(h[12]|p|ul|ol|table)\b[^>]*>[\s\S]*?<\/\1>/gi;
  const values: string[] = [];
  let foundHeading = false;
  let block: RegExpExecArray | null;

  while ((block = blockRe.exec(html))) {
    const tag = block[1].toLowerCase();
    const blockHtml = block[0];
    const text = stripTags(blockHtml);
    const normalizedText = normalizeHeading(text);

    if (tag !== "table" && headingMatches(normalizedText, wanted)) {
      foundHeading = true;
      continue;
    }

    if (!foundHeading) continue;

    if (((tag === "h1" || tag === "h2") || isKnownSectionHeading(normalizedText)) && values.length > 0) break;
    if (tag === "table") continue;

    if (text) values.push(text);
  }

  return values.filter((value) => !headingMatches(normalizeHeading(value), wanted));
}

function allTables(html: string): string[] {
  return Array.from(html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)).map((match) => match[0]);
}

function parseRows(tableHtml: string | null): string[][] {
  if (!tableHtml) return [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const rows: string[][] = [];
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(tableHtml))) {
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    const cells: string[] = [];
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(m[1]))) {
      cells.push(stripTags(cm[1]));
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function findFieldValue(html: string, labels: string[]): string | null {
  const wanted = new Set(labels.map(normalizeHeading));
  for (const table of allTables(html)) {
    for (const row of parseRows(table)) {
      for (let i = 0; i < row.length - 1; i++) {
        const label = normalizeHeading(row[i].replace(/:$/, ""));
        if (wanted.has(label)) {
          const value = cleanHeading(row[i + 1]);
          if (value) return value;
        }
      }
    }
  }
  return null;
}

function composePersonName(firstName: string | null, surname: string | null): string | null {
  const first = cleanHeading(firstName ?? "");
  const last = cleanHeading(surname ?? "");
  if (first && last && !normalizeHeading(first).includes(normalizeHeading(last))) {
    return `${first} ${last}`;
  }
  return first || last || null;
}

function parseActivities(html: string): Activity[] {
  const table = extractSectionTable(html, "Project Activities") ?? findActivityTable(html);
  const rows = parseRows(table);
  const sectionTextRows = extractSectionContent(html, "Project Activities")
    .map((text) => ({ day: "", project: "General delivery", hours: "", work: text, notes: "" }))
    .filter((activity) => !isTemplateInstruction([activity.work]));
  if (!rows.length) return uniqueActivities(sectionTextRows);
  const header = rows[0].map(normalizeHeading);
  const isHeaderRow = header.some((h) => h === "day" || h === "date") &&
    header.some((h) => h.includes("project") || h.includes("activity") || h.includes("work"));
  const dataRows = isHeaderRow ? rows.slice(1) : rows;

  const activities: Activity[] = [];
  let lastDay = "";
  for (const r of dataRows) {
    let day: string, project: string, hours: string, work: string, notes: string, details: string[] = [];
    if (isHeaderRow) {
      day = cellByHeader(r, header, ["day", "date"]) || lastDay;
      project = cellByHeader(r, header, ["project", "system", "application", "client"]) || "";
      hours = cellByHeader(r, header, ["hours", "hrs", "time"]) || "";
      work = cellByHeader(r, header, ["work", "activity", "activities", "task", "description", "deliverable"]) || "";
      notes = cellByHeader(r, header, ["notes", "comments", "status", "outcome"]) || "";
      details = extraCellsByHeader(r, header, [
        "day", "date", "project", "system", "application", "client", "hours", "hrs", "time",
        "work", "activity", "activities", "task", "description", "deliverable", "notes", "comments", "status", "outcome",
      ]);
      lastDay = day || lastDay;
    } else if (r.length >= 5) {
      [day, project, hours, work, notes] = r;
      details = r.slice(5).map((cell) => cell.trim()).filter(Boolean);
      lastDay = day || lastDay;
    } else if (r.length === 4) {
      [project, hours, work, notes] = r;
      day = lastDay;
    } else if (r.length === 3) {
      [project, work, notes] = r;
      day = lastDay;
      hours = "";
    } else if (r.length === 2) {
      [project, work] = r;
      day = lastDay;
      hours = "";
      notes = "";
    } else if (r.length === 1) {
      day = lastDay;
      project = "General delivery";
      hours = "";
      work = r[0];
      notes = "";
    } else {
      continue;
    }
    if (isTemplateInstruction(r)) continue;
    if (!project && !work && !notes) continue; // blank Sat/Sun filler rows
    activities.push({ day, project, hours, work, notes, ...(details.length ? { details } : {}) });
  }
  return uniqueActivities([...activities, ...sectionTextRows]);
}

function cellByHeader(row: string[], header: string[], aliases: string[]) {
  const index = header.findIndex((h) => aliases.some((alias) => h === alias || h.includes(alias)));
  return index >= 0 ? row[index] ?? "" : "";
}

function extraCellsByHeader(row: string[], header: string[], mappedAliases: string[]) {
  return row
    .map((cell, index) => {
      const value = cell.trim();
      const label = header[index] || `column ${index + 1}`;
      const mapped = mappedAliases.some((alias) => label === alias || label.includes(alias));
      return value && !mapped ? `${cleanHeading(label)}: ${value}` : "";
    })
    .filter(Boolean);
}

function findActivityTable(html: string): string | null {
  for (const table of allTables(html)) {
    const rows = parseRows(table);
    if (!rows.length) continue;
    const header = rows[0].map(normalizeHeading);
    const hasDay = header.some((h) => h === "day" || h === "date");
    const hasDeliveryColumn = header.some((h) =>
      h.includes("project") || h.includes("activity") || h.includes("work") || h.includes("task")
    );
    if (hasDay && hasDeliveryColumn) return table;
  }
  return null;
}

function parseGenericTable(html: string, headingText: string): string[][] {
  const table = extractSectionTable(html, headingText);
  const rows = parseRows(table);
  const hasHeader = rows.length > 1 && rows[0].some((cell) =>
    /description|details?|item|risk|issue|action|learning|improvement|value|efficiency|status|owner|date/i.test(cell)
  );
  const header = hasHeader ? rows[0].map(cleanHeading) : [];
  const dataRows = hasHeader ? rows.slice(1).map((row) => labelRowCells(row, header)) : rows;
  const tableRows = dataRows
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some((c) => c.length > 0))
    .filter((row) => !isTemplateInstruction(row));

  const textRows = extractSectionContent(html, headingText)
    .map((text) => [text])
    .filter((row) => !isTemplateInstruction(row));

  return uniqueRows([...tableRows, ...textRows]);
}

function labelRowCells(row: string[], header: string[]) {
  return row.map((cell, index) => {
    const value = cell.trim();
    if (!value) return "";
    const label = header[index]?.replace(/:$/, "").trim();
    return label ? `${label}: ${value}` : value;
  });
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
    const key = row.map((cell) => cell.toLowerCase().replace(/\s+/g, " ").trim()).join("\u001f");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueActivities(activities: Activity[]) {
  const seen = new Set<string>();
  return activities.filter((activity) => {
    const key = [
      activity.day,
      activity.project,
      activity.hours,
      activity.work,
      activity.notes,
      ...(activity.details ?? []),
    ].map((value) => value.toLowerCase().replace(/\s+/g, " ").trim()).join("\u001f");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function parseWeeklyReportBuffer(
  buffer: ArrayBuffer,
  sourceFile: string,
): Promise<ParsedWeeklyReport> {
  const { value: html } = await mammoth.convertToHtml(
    { buffer: Buffer.from(buffer) },
    {
      styleMap: [
        "p[style-name='Heading 1'] => h1:fresh",
        "p[style-name='Heading 2'] => h2:fresh",
      ],
    },
  );

  const firstName = findFieldValue(html, ["Name", "First Name", "Employee Name", "Consultant Name"]);
  const surname = findFieldValue(html, ["Surname", "Last Name"]);
  const weekStart = findFieldValue(html, ["Week Start", "Week Starting", "Start Date"]);
  const deliveryManager = findFieldValue(html, ["Delivery Manager"]);

  return {
    sourceFile,
    name: composePersonName(firstName, surname),
    weekStart,
    deliveryManager,
    activities: parseActivities(html),
    risks: parseGenericTable(html, "Project Risks/Issues"),
    knowledgeTransfer: parseGenericTable(html, "Knowledge and Skill Transfer"),
    continuousImprovement: parseGenericTable(html, "Continuous Improvements and Value Add"),
    continuousLearning: parseGenericTable(html, "Continuous Learning"),
    aiEfficiency: parseGenericTable(html, "AI & Efficiency Enhancements"),
  };
}
