import { PDFDocument } from "@cantoo/pdf-lib";
import { openPdf } from "./load.ts";
import { type PageRange, parseRanges } from "./ranges.ts";
import type { PdfSource } from "./types.ts";

async function extract(doc: PDFDocument, ranges: PageRange[]): Promise<Uint8Array[]> {
  const outputs: Uint8Array[] = [];
  for (const { start, end } of ranges) {
    const out = await PDFDocument.create();
    const indices = Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i);
    for (const page of await out.copyPages(doc, indices)) out.addPage(page);
    outputs.push(await out.save());
  }
  return outputs;
}

/** One output PDF per comma-separated part of `spec` (see parseRanges). */
export async function splitPdf(src: PdfSource, spec: string): Promise<Uint8Array[]> {
  const doc = await openPdf(src);
  return extract(doc, parseRanges(spec, doc.getPageCount()));
}

/** One output PDF per page. */
export async function splitEveryPage(src: PdfSource): Promise<Uint8Array[]> {
  const doc = await openPdf(src);
  return extract(doc, doc.getPageIndices().map((i) => ({ start: i + 1, end: i + 1 })));
}
