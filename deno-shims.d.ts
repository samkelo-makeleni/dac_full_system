declare namespace Deno {
  const env: {
    get(name: string): string | undefined;
  };

  function serve(handler: (req: Request) => Promise<Response> | Response): void;
}

declare module "npm:*" {
  const mod: any;
  export default mod;
}

declare module "npm:@supabase/supabase-js@2" {
  export function createClient(...args: any[]): any;
}

declare module "npm:docx@9.6.1" {
  export const Document: any;
  export const Packer: any;
  export const Paragraph: any;
  export const TextRun: any;
  export const Table: any;
  export const TableRow: any;
  export const TableCell: any;
  export const WidthType: any;
  export const ShadingType: any;
  export const HeadingLevel: any;
  export const AlignmentType: any;
  export const BorderStyle: any;
  export const ImageRun: any;
  export const LevelFormat: any;
  export const VerticalAlign: any;
  export const Footer: any;
}

declare module "npm:mammoth@1.7.2" {
  const mammoth: any;
  export default mammoth;
}

declare module "node:buffer" {
  export const Buffer: any;
}
