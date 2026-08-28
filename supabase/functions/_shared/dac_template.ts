// Deno port of dac_template.js — produces byte-identical layout to the
// version used earlier in this project. Only the module system and the
// logo-loading mechanism (base64 constant instead of fs.readFileSync)
// differ from the Node original.

// deno-lint-ignore-file no-explicit-any
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, ShadingType, AlignmentType, BorderStyle,
  ImageRun, LevelFormat, VerticalAlign, Footer,
} from "npm:docx@9.6.1";
import { FALCORP_LOGO_BASE64 } from "./logo_base64.ts";

const TEAL = "1F6E8C";
const GREY = "D9D9D9";

export interface DacSection {
  title: string;
  type: "paragraph" | "bulletsPlain" | "bulletsLead";
  text?: string;
  items?: any[];
}

export interface DacData {
  projectName: string;
  description: string;
  poNumber: string;
  reportingPeriod: string;
  client: string;
  projectManager: string;
  certificationBlurb: string;
  company: { name: string; directors: string; regLine: string; addressLine1: string; addressLine2: string };
  signatories: { heading: string; name: string; role: string; date?: string }[];
  sections: DacSection[];
}

export async function buildDac(data: DacData): Promise<Uint8Array> {
  const fullWidth = 9350;
  const col1 = 2400;
  const col2 = fullWidth - col1;

  function headerCellTeal(text: string, width: number) {
    return new TableCell({
      width: { size: width, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: TEAL },
      verticalAlign: VerticalAlign.CENTER,
      margins: { top: 100, bottom: 100, left: 120, right: 120 },
      children: [new Paragraph({ children: [new TextRun({ text, bold: true, color: "FFFFFF" })] })],
    });
  }
  function labelCell(text: string, width: number) {
    return new TableCell({
      width: { size: width, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: GREY },
      verticalAlign: VerticalAlign.CENTER,
      margins: { top: 100, bottom: 100, left: 120, right: 120 },
      children: [new Paragraph({ children: [new TextRun({ text, bold: true })] })],
    });
  }
  function valueCell(text: string, width: number, opts: { bold?: boolean } = {}) {
    return new TableCell({
      width: { size: width, type: WidthType.DXA },
      verticalAlign: VerticalAlign.CENTER,
      margins: { top: 100, bottom: 100, left: 120, right: 120 },
      children: [new Paragraph({ children: [new TextRun({ text, bold: !!opts.bold })] })],
    });
  }

  const infoTable = new Table({
    width: { size: fullWidth, type: WidthType.DXA },
    columnWidths: [col1, col2],
    rows: [
      new TableRow({
        children: [
          headerCellTeal("Project Name:", col1),
          new TableCell({
            width: { size: col2, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, fill: TEAL },
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 100, bottom: 100, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: data.projectName, bold: true, color: "FFFFFF" })] })],
          }),
        ],
      }),
      new TableRow({ children: [labelCell("Description:", col1), valueCell(data.description, col2)] }),
      new TableRow({ children: [labelCell("PO Number", col1), valueCell(data.poNumber, col2)] }),
      new TableRow({ children: [labelCell("Date:", col1), valueCell(data.reportingPeriod, col2, { bold: true })] }),
    ],
  });

  const spacerRow = new Table({
    width: { size: fullWidth, type: WidthType.DXA },
    columnWidths: [fullWidth],
    rows: [new TableRow({
      children: [new TableCell({
        width: { size: fullWidth, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: TEAL },
        children: [new Paragraph({ children: [new TextRun({ text: " " })] })],
      })],
    })],
  });

  function bodyBox(text: string) {
    return new Table({
      width: { size: fullWidth, type: WidthType.DXA },
      columnWidths: [fullWidth],
      borders: {
        top: { style: BorderStyle.SINGLE, size: 4, color: TEAL },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: TEAL },
        left: { style: BorderStyle.SINGLE, size: 4, color: TEAL },
        right: { style: BorderStyle.SINGLE, size: 4, color: TEAL },
      },
      rows: [new TableRow({
        children: [new TableCell({
          width: { size: fullWidth, type: WidthType.DXA },
          margins: { top: 150, bottom: 150, left: 150, right: 150 },
          children: [new Paragraph({ children: [new TextRun({ text })] })],
        })],
      })],
    });
  }

  function h(text: string) {
    return new Paragraph({
      spacing: { before: 260, after: 80 },
      children: [new TextRun({ text, bold: true, size: 22 })],
    });
  }
  function bullet(boldLead: string, rest: string) {
    return new Paragraph({
      numbering: { reference: "bullets", level: 0 },
      spacing: { after: 100 },
      children: [new TextRun({ text: boldLead + ": ", bold: true }), new TextRun({ text: rest })],
    });
  }
  function plainBullet(text: string) {
    return new Paragraph({
      numbering: { reference: "bullets", level: 0 },
      spacing: { after: 100 },
      children: [new TextRun({ text })],
    });
  }
  function para(text: string) {
    return new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text })] });
  }

  function footerParas() {
    return [
      new Paragraph({
        spacing: { before: 60 },
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: "AAAAAA" } },
        children: [new TextRun({ text: data.company.name, bold: true, size: 14 })],
      }),
      new Paragraph({ children: [new TextRun({ text: `Directors: ${data.company.directors}`, size: 14 })] }),
      new Paragraph({ children: [new TextRun({ text: data.company.regLine, size: 14 })] }),
      new Paragraph({ children: [new TextRun({ text: data.company.addressLine1, size: 14 })] }),
      new Paragraph({ children: [new TextRun({ text: data.company.addressLine2, size: 14 })] }),
    ];
  }

  function sigTable() {
    const w1 = 2300, w2 = 2350, w3 = 2350, w4 = 2350;
    const rows = [];
    data.signatories.forEach((sig) => {
      rows.push(new TableRow({
        children: [new TableCell({
          columnSpan: 4,
          width: { size: fullWidth, type: WidthType.DXA },
          shading: { type: ShadingType.CLEAR, fill: TEAL },
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: sig.heading, bold: true, color: "FFFFFF" })] })],
        })],
      }));
      rows.push(new TableRow({
        children: [labelCell("Name", w1), valueCell(sig.name, w2), labelCell("Role", w3), valueCell(sig.role, w4)],
      }));
      rows.push(new TableRow({
        children: [labelCell("Signature", w1), valueCell("", w2), labelCell("Date", w3), valueCell(sig.date || "", w4)],
      }));
    });
    return new Table({ width: { size: fullWidth, type: WidthType.DXA }, columnWidths: [w1, w2, w3, w4], rows });
  }

  const sectionRenderers = {
    paragraph: (s) => [h(s.title), para(s.text || "")],
    bulletsPlain: (s) => [h(s.title), ...(s.items || []).map((i: string) => plainBullet(i))],
    bulletsLead: (s) => [h(s.title), ...(s.items || []).map((i: any) => bullet(i.lead, i.text))],
  };

  const indexItems = data.sections.map((s) => s.title);
  const bodyChildren = [];
  data.sections.forEach((s) => {
    const renderer = sectionRenderers[s.type];
    if (!renderer) throw new Error(`Unknown section type: ${s.type}`);
    bodyChildren.push(...renderer(s));
  });

  const doc = new Document({
    numbering: {
      config: [{
        reference: "bullets",
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 420, hanging: 260 } } },
        }],
      }],
    },
    sections: [{
      properties: {
        page: { size: { width: 12240, height: 15840 }, margin: { top: 900, bottom: 900, left: 900, right: 900 } },
      },
      footers: { default: new Footer({ children: footerParas() }) },
      children: [
        new Paragraph({ children: [new ImageRun({ data: FALCORP_LOGO_BASE64, type: "png", transformation: { width: 170, height: 124 } })] }),
        new Paragraph({ text: "" }),
        new Paragraph({ children: [new TextRun({ text: "Delivery Acceptance Certificate (DAC)", bold: true, size: 32 })], spacing: { after: 200 } }),
        infoTable,
        spacerRow,
        bodyBox(data.certificationBlurb),
        new Paragraph({ text: "", spacing: { after: 160 } }),
        new Paragraph({ children: [new TextRun({ text: `Monthly Delivery Report - ${data.client}`, bold: true })] }),
        new Paragraph({ children: [new TextRun({ text: "Project Manager: ", bold: true }), new TextRun({ text: data.projectManager })] }),
        new Paragraph({ children: [new TextRun({ text: "Reporting Period: ", bold: true }), new TextRun({ text: data.reportingPeriod })] }),
        new Paragraph({ children: [new TextRun({ text: "Index of Topics", bold: true })], spacing: { before: 120 } }),
        ...indexItems.map((t) => plainBullet(t)),
        ...bodyChildren,
        new Paragraph({ text: "", spacing: { before: 300 } }),
        sigTable(),
      ],
    }],
  });

  const buf = await Packer.toBuffer(doc);
  return new Uint8Array(buf);
}
