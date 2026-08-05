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
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanHeading(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function sectionAliases(headingText: string): string[] {
  const aliases: Record<string, string[]> = {
    "Project Activities": ["Project Activities"],
    "Project Risks/Issues": ["Project Risks/Issues", "Project Risks / Issues", "Project Risks and Issues"],
    "Knowledge and Skill Transfer": ["Knowledge and Skill Transfer"],
    "Continuous Improvements and Value Add": [
      "Continuous Improvements and Value Add",
      "Continuous Improvement and Value Add",
    ],
    "Continuous Learning": ["Continuous Learning"],
    "AI & Efficiency Enhancements": [
      "AI & Efficiency Enhancements",
      "AI and Efficiency Enhancements",
      "AI Efficiency Enhancements",
    ],
  };
  return aliases[headingText] ?? [headingText];
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
    if (wanted.has(text)) {
      foundHeading = true;
    }
  }

  return null;
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

function parseActivities(html: string): Activity[] {
  const table = extractSectionTable(html, "Project Activities");
  const rows = parseRows(table);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.toLowerCase());
  const isHeaderRow = header.includes("day");
  const dataRows = isHeaderRow ? rows.slice(1) : rows;

  const activities: Activity[] = [];
  let lastDay = "";
  for (const r of dataRows) {
    let day: string, project: string, hours: string, work: string, notes: string;
    if (r.length >= 5) {
      [day, project, hours, work, notes] = r;
      lastDay = day || lastDay;
    } else if (r.length === 4) {
      [project, hours, work, notes] = r;
      day = lastDay;
    } else {
      continue;
    }
    if (!project && !work && !notes) continue; // blank Sat/Sun filler rows
    activities.push({ day, project, hours, work, notes });
  }
  return activities;
}

function parseGenericTable(html: string, headingText: string): string[][] {
  const table = extractSectionTable(html, headingText);
  const rows = parseRows(table);
  if (!rows.length) return [];
  const dataRows = rows.slice(1); // drop header row
  return dataRows
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some((c) => c.length > 0));
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

  const nameMatch = /Name<\/strong>[\s\S]*?<td>([^<]*)/i.exec(html) ||
    /Name<\/[a-z]+>[\s\S]{0,80}?<td[^>]*>([^<]*)/i.exec(html);
  const weekStartMatch = /Week Start[\s\S]*?<td>([^<]*)/i.exec(html);
  const deliveryManagerMatch = /Delivery\s*Manager[\s\S]{0,80}?<td[^>]*>([^<]*)/i.exec(html);

  return {
    sourceFile,
    name: nameMatch ? nameMatch[1].trim() : null,
    weekStart: weekStartMatch ? weekStartMatch[1].trim() : null,
    deliveryManager: deliveryManagerMatch ? deliveryManagerMatch[1].trim() : null,
    activities: parseActivities(html),
    risks: parseGenericTable(html, "Project Risks/Issues"),
    knowledgeTransfer: parseGenericTable(html, "Knowledge and Skill Transfer"),
    continuousImprovement: parseGenericTable(html, "Continuous Improvements and Value Add"),
    continuousLearning: parseGenericTable(html, "Continuous Learning"),
    aiEfficiency: parseGenericTable(html, "AI & Efficiency Enhancements"),
  };
}
