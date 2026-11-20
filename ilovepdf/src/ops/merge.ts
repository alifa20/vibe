import { PDFDocument } from "@cantoo/pdf-lib";
import { appendPages, openPdf } from "./load.ts";
import type { PdfSource } from "./types.ts";

/** Join every page of every input, in the order given, into one unencrypted PDF. */
export async function mergePdfs(inputs: PdfSource[]): Promise<Uint8Array> {
  if (inputs.length === 0) throw new Error("Add at least one PDF to merge.");
  const out = await PDFDocument.create();
  for (const input of inputs) {
    const doc = await openPdf(input);
    await appendPages(out, doc, doc.getPageIndices());
  }
  return out.save();
}
