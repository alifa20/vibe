import { PDFDocument, degrees } from "@cantoo/pdf-lib";
import { openPdf } from "./load.ts";
import type { PdfSource } from "./types.ts";

/** One page of the output: which source page (0-based) it comes from and how far to turn it. */
export interface PageEdit {
  from: number;
  /** Clockwise degrees added to the page's current rotation. A multiple of 90. */
  rotate: number;
}

export const normaliseAngle = (a: number): number => ((Math.round(a / 90) * 90) % 360 + 360) % 360;

/**
 * Rebuild a PDF from a list of page edits: the list order is the new page order, a source
 * page left out of the list is deleted, and each page's rotation is turned by `rotate`.
 */
export async function editPages(src: PdfSource, edits: PageEdit[]): Promise<Uint8Array> {
  if (edits.length === 0) throw new Error("Keep at least one page: a PDF cannot be empty.");
  const doc = await openPdf(src);
  const count = doc.getPageCount();
  for (const { from } of edits) {
    if (!Number.isInteger(from) || from < 0 || from >= count) {
      throw new Error(`There is no page ${from + 1}: this PDF has only ${count} pages.`);
    }
  }
  const out = await PDFDocument.create();
  const copies = await out.copyPages(doc, edits.map((e) => e.from));
  copies.forEach((page, i) => {
    const current = doc.getPage(edits[i].from).getRotation().angle;
    page.setRotation(degrees(normaliseAngle(current + edits[i].rotate)));
    out.addPage(page);
  });
  return out.save();
}
