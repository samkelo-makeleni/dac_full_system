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

async function packToArrayBuffer(doc: InstanceType<typeof Document>): Promise<ArrayBuffer> {
  const bytes = await Packer.toBuffer(doc);
  const view = new Uint8Array(bytes);
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy.buffer as ArrayBuffer;
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

  const parsed = await parseWeeklyReportBuffer(await packToArrayBuffer(doc), "fixture.docx");

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

Deno.test("parseWeeklyReportBuffer extracts every project activity table in the section", async () => {
  const doc = new Document({
    sections: [{
      children: [
        heading("Project Activities"),
        table([
          ["Day", "Project", "Hours", "Work", "Notes"],
          ["Monday", "Billing", "4", "Reconciled failed charge events", "Done"],
          ["", "Billing", "4", "Prepared deployment notes", "Ready"],
        ]),
        table([
          ["Day", "Project", "Hours", "Work", "Notes"],
          ["Tuesday", "Portal", "6", "Implemented manager approval fixes", "Merged"],
          ["Wednesday", "Portal", "7", "Validated DAC generation evidence", "Complete"],
        ]),
        heading("Project Risks/Issues"),
        table([
          ["Risk", "Impact", "Action"],
          ["None", "No delivery impact", "Monitor"],
        ]),
      ],
    }],
  });

  const parsed = await parseWeeklyReportBuffer(await packToArrayBuffer(doc), "multi-table.docx");
  const workItems = parsed.activities.map((activity) => activity.work);

  assertEquals(parsed.activities.length, 4, "activity count");
  assertTrue(workItems.includes("Reconciled failed charge events"), "first table first row");
  assertTrue(workItems.includes("Prepared deployment notes"), "first table continuation row");
  assertTrue(workItems.includes("Implemented manager approval fixes"), "second table first row");
  assertTrue(workItems.includes("Validated DAC generation evidence"), "second table second row");
});

Deno.test("parseWeeklyReportBuffer extracts activities when the section title is inside a table", async () => {
  const doc = new Document({
    sections: [{
      children: [
        table([
          ["Project Activities"],
          ["Day", "Project", "Hours", "Work", "Notes"],
          ["Thursday", "Workflow", "5", "Mapped approval notification path", "Reviewed"],
          ["Friday", "Workflow", "3", "Closed parser extraction gaps", "Released"],
          ["Project Risks/Issues"],
          ["Risk", "Impact", "Action"],
          ["Template drift", "Could drop rows", "Covered with parser tests"],
        ]),
      ],
    }],
  });

  const parsed = await parseWeeklyReportBuffer(await packToArrayBuffer(doc), "embedded-section.docx");
  const workItems = parsed.activities.map((activity) => activity.work);

  assertEquals(parsed.activities.length, 2, "activity count");
  assertTrue(workItems.includes("Mapped approval notification path"), "embedded title first activity");
  assertTrue(workItems.includes("Closed parser extraction gaps"), "embedded title second activity");
  assertTrue(!workItems.includes("Could drop rows"), "next section was not parsed as an activity");
});

Deno.test("parseWeeklyReportBuffer treats activity Details as work performed", async () => {
  const doc = new Document({
    sections: [{
      children: [
        heading("Project Activities"),
        table([
          ["Day", "Project", "Hours", "Details", "Status"],
          ["Monday", "QR Portal OTP", "8", "Implemented OTP verification and response validation", "Complete"],
          ["Tuesday", "Mobile Number Portability", "7", "Built RICA and switch-to-Telkom screens", "In review"],
        ]),
      ],
    }],
  });

  const parsed = await parseWeeklyReportBuffer(await packToArrayBuffer(doc), "details-column.docx");

  assertEquals(parsed.activities.length, 2, "activity count");
  assertEquals(
    parsed.activities[0].work,
    "Implemented OTP verification and response validation",
    "first details activity",
  );
  assertEquals(parsed.activities[0].notes, "Complete", "first status note");
  assertEquals(parsed.activities[1].work, "Built RICA and switch-to-Telkom screens", "second details activity");
});
