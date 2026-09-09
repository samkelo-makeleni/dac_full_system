import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from "npm:docx@9.6.1";
import { parseWeeklyReportBuffer } from "./docx_parser.ts";

function assertEquals<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertIncludes(value: string, expected: string, message: string) {
  if (!value.includes(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(value)} to include ${JSON.stringify(expected)}`);
  }
}

function cell(text: string) {
  return new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text })] })],
  });
}

function row(values: string[]) {
  return new TableRow({ children: values.map(cell) });
}

function table(rows: string[][]) {
  return new Table({ rows: rows.map(row) });
}

function heading(text: string) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_1 });
}

Deno.test("parseWeeklyReportBuffer extracts core weekly report sections", async () => {
  const doc = new Document({
    sections: [{
      children: [
        table([
          ["Name", "Samkelo"],
          ["Surname", "Makeleni"],
          ["Week Start", "2026-08-03"],
          ["Delivery Manager", "Eben le Roux"],
        ]),
        heading("Project Activities"),
        table([
          ["Day", "Project", "Hours", "Work", "Notes"],
          ["Monday", "Telkom CSB", "8", "Completed DAC automation parser test", "Ready for review"],
        ]),
        heading("Project Risks/Issues"),
        table([
          ["Risk", "Impact", "Action"],
          ["Late dependency", "Could delay acceptance", "Escalated early"],
        ]),
        heading("Knowledge and Skill Transfer"),
        table([
          ["Topic", "Details"],
          ["Supabase Edge Functions", "Shared parsing workflow with the team"],
        ]),
        heading("Continuous Improvements and Value Add"),
        table([
          ["Improvement", "Value"],
          ["Automated parser coverage", "Earlier detection of template drift"],
        ]),
        heading("Continuous Learning"),
        table([
          ["Learning", "Outcome"],
          ["Deno testing", "Added CI parser coverage"],
        ]),
        heading("AI & Efficiency Enhancements"),
        table([
          ["Enhancement", "Value"],
          ["OpenAI narrative fallback", "Reduced manual DAC drafting effort"],
        ]),
      ],
    }],
  });

  const bytes = await Packer.toBuffer(doc);
  const buffer = new Uint8Array(bytes).buffer;
  const parsed = await parseWeeklyReportBuffer(buffer, "fixture.docx");

  assertEquals(parsed.name, "Samkelo Makeleni", "name");
  assertEquals(parsed.weekStart, "2026-08-03", "week start");
  assertEquals(parsed.deliveryManager, "Eben le Roux", "delivery manager");
  assertEquals(parsed.activities.length, 1, "activity count");
  assertEquals(parsed.activities[0].project, "Telkom CSB", "activity project");
  assertIncludes(parsed.activities[0].work, "parser test", "activity work");
  assertEquals(parsed.risks.length, 1, "risk count");
  assertIncludes(parsed.risks[0].join(" "), "Late dependency", "risk row");
  assertEquals(parsed.knowledgeTransfer.length, 1, "knowledge transfer count");
  assertEquals(parsed.continuousImprovement.length, 1, "continuous improvement count");
  assertEquals(parsed.continuousLearning.length, 1, "continuous learning count");
  assertEquals(parsed.aiEfficiency.length, 1, "AI efficiency count");
});
