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
import { parseWeeklyReportBuffer } from "../supabase/functions/_shared/docx_parser.ts";

function assertEquals<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(value: boolean, message: string) {
  if (!value) throw new Error(message);
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
  const activity = parsed.activities.find((item) =>
    item.project === "Telkom CSB" && item.work.includes("parser test")
  );
  assertTrue(!!activity, "expected parsed Telkom CSB parser-test activity");
  assertTrue(parsed.risks.some((row) => row.join(" ").includes("Late dependency")), "expected risk row");
  assertTrue(
    parsed.knowledgeTransfer.some((row) => row.join(" ").includes("Supabase Edge Functions")),
    "expected knowledge transfer row",
  );
  assertTrue(
    parsed.continuousImprovement.some((row) => row.join(" ").includes("Automated parser coverage")),
    "expected continuous improvement row",
  );
  assertTrue(
    parsed.continuousLearning.some((row) => row.join(" ").includes("Deno testing")),
    "expected continuous learning row",
  );
  assertTrue(
    parsed.aiEfficiency.some((row) => row.join(" ").includes("OpenAI narrative fallback")),
    "expected AI efficiency row",
  );
});
