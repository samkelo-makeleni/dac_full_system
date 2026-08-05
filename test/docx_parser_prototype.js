/**
 * Prototype parser — proves out the docx -> structured JSON logic
 * using real weekly report files, before porting to the Deno edge function.
 *
 * Uses `pandoc` (shell out) to get clean table HTML, then a small
 * regex-based table walker (no cheerio needed for this prototype).
 * The production edge function ports this same logic using
 * npm:mammoth + npm:cheerio inside Deno.
 */
const { execSync } = require("child_process");
const fs = require("fs");

function docxToHtml(path) {
  return execSync(`pandoc -t html "${path}"`, { maxBuffer: 1024 * 1024 * 20 }).toString();
}

// Very small HTML table extractor: given HTML and a heading id, grab the
// first <table>...</table> that appears after that heading and before the
// next <h1>/<h2>.
function extractSectionTable(html, headingId) {
  const headingRe = new RegExp(`<h[12] id="${headingId}"[^>]*>`, "i");
  const startMatch = headingRe.exec(html);
  if (!startMatch) return null;
  const afterHeading = html.slice(startMatch.index + startMatch[0].length);
  const nextHeadingMatch = /<h[12][ >]/i.exec(afterHeading);
  const section = nextHeadingMatch ? afterHeading.slice(0, nextHeadingMatch.index) : afterHeading;
  const tableMatch = /<table>([\s\S]*?)<\/table>/i.exec(section);
  return tableMatch ? tableMatch[0] : null;
}

function stripTags(s) {
  return s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
}

function parseRows(tableHtml) {
  if (!tableHtml) return [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const rows = [];
  let m;
  while ((m = rowRe.exec(tableHtml))) {
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    const cells = [];
    let cm;
    while ((cm = cellRe.exec(m[1]))) {
      cells.push(stripTags(cm[1]));
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

// Project Activities table has a merged "Day" column (rowspan), so we
// forward-fill it as we walk the rows.
function parseActivities(html) {
  const table = extractSectionTable(html, "project-activities");
  const rows = parseRows(table);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.toLowerCase());
  const isHeaderRow = header.includes("day");
  const dataRows = isHeaderRow ? rows.slice(1) : rows;

  const activities = [];
  let lastDay = "";
  for (const r of dataRows) {
    let day, project, hours, work, notes;
    if (r.length === 5) {
      [day, project, hours, work, notes] = r;
      lastDay = day || lastDay;
    } else if (r.length === 4) {
      // rowspan collapsed the Day cell
      [project, hours, work, notes] = r;
      day = lastDay;
    } else {
      continue;
    }
    if (!project && !work && !notes) continue; // blank filler row (Sat/Sun)
    activities.push({ day, project, hours, work, notes });
  }
  return activities;
}

// Generic 4-column tables (Risks, Knowledge, Improvements, Learning, AI)
// all follow "first column repeats via rowspan, rest are plain" OR are
// simply empty. We just filter out fully-blank rows.
function parseGenericTable(html, headingId) {
  const table = extractSectionTable(html, headingId);
  const rows = parseRows(table);
  if (!rows.length) return [];
  const dataRows = rows.slice(1); // drop header row
  return dataRows
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some((c) => c.length > 0));
}

function parseWeeklyReport(path) {
  const html = docxToHtml(path);

  // Header block: Surname / Name / Delivery Manager / Team Lead / Week Start / Practice
  const surnameMatch = /Surname[^<]*<\/strong><\/td>\s*<td>([^<]*)/i.exec(html);
  const nameMatch = /Name<\/strong><\/td>\s*<td>([^<]*)/i.exec(html);
  const weekStartMatch = /Week Start[\s\S]*?<td>([^<]*)/i.exec(html);
  const deliveryManagerMatch = /Delivery\s*Manager[^<]*<\/strong><\/td>\s*<td>([^<]*)/i.exec(html);

  return {
    sourceFile: path.split("/").pop(),
    surname: surnameMatch ? surnameMatch[1].trim() : null,
    name: nameMatch ? nameMatch[1].trim() : null,
    weekStart: weekStartMatch ? weekStartMatch[1].trim() : null,
    deliveryManager: deliveryManagerMatch ? deliveryManagerMatch[1].trim() : null,
    activities: parseActivities(html),
    risks: parseGenericTable(html, "project-risksissues"),
    knowledgeTransfer: parseGenericTable(html, "knowledge-and-skill-transfer"),
    continuousImprovement: parseGenericTable(html, "continuous-improvements-and-value-add"),
    continuousLearning: parseGenericTable(html, "continuous-learning"),
    aiEfficiency: parseGenericTable(html, "ai-efficiency-enhancements"),
  };
}

module.exports = { parseWeeklyReport };

// CLI test mode: node docx_parser_prototype.js <file1.docx> <file2.docx> ...
if (require.main === module) {
  const files = process.argv.slice(2);
  const results = files.map(parseWeeklyReport);
  console.log(JSON.stringify(results, null, 2));
}
