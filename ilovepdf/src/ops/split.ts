import { PDFDocument } from "@cantoo/pdf-lib";
import { appendPages, openPdf } from "./load.ts";
import { type PageRange, parseRanges } from "./ranges.ts";
import type { PdfSource } from "./types.ts";

async function extract(doc: PDFDocument, ranges: PageRange[]): Promise<Uint8Array[]> {
  const outputs: Uint8Array[] = [];
  for (const { start, end } of ranges) {
    const out = await PDFDocument.create();
    await appendPages(out, doc, Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i));
    outputs.push(await out.save());
  }
  return outputs;
}

/** One output PDF per comma-separated part of `spec` (see parseRanges), with the range it holds. */
export async function splitPdf(src: PdfSource, spec: string): Promise<{ range: PageRange; bytes: Uint8Array }[]> {
  const doc = await openPdf(src);
  const ranges = parseRanges(spec, doc.getPageCount());
  const parts = await extract(doc, ranges);
  return parts.map((bytes, i) => ({ range: ranges[i], bytes }));
}

/** One output PDF per page. */
export async function splitEveryPage(src: PdfSource): Promise<Uint8Array[]> {
  const doc = await openPdf(src);
  return extract(doc, doc.getPageIndices().map((i) => ({ start: i + 1, end: i + 1 })));
}
