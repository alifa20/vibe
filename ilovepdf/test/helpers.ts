import { readFileSync } from "node:fs";
import { PDFDocument } from "@cantoo/pdf-lib";
import type { RasterDoc, Rasterizer } from "../src/ops/types.ts";

export const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

/** A PDF whose pages are sized 100+i by 200+i points, so each page can be told apart. */
export async function makePdf(pageCount: number, opts: { encryptWith?: string } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage([100 + i, 200 + i]);
  if (opts.encryptWith) doc.encrypt({ userPassword: opts.encryptWith, ownerPassword: `${opts.encryptWith}-owner` });
  return doc.save();
}

export async function pageWidths(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => Math.round(p.getWidth()));
}

/**
 * Stand-in for the pdf.js + canvas rasteriser. Each "rendered" page is a real JPEG fixture
 * (or the PNG one) so the result can be embedded by pdf-lib; sizes come from the source PDF.
 */
export function stubRasterizer(): Rasterizer & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async open(bytes): Promise<RasterDoc> {
      const doc = await PDFDocument.load(bytes);
      const pages = doc.getPages();
      calls.push(`open:${pages.length}`);
      return {
        numPages: pages.length,
        async renderPage(n, { scale, format, quality }) {
          calls.push(`render:${n}:${scale}:${format}:${quality ?? "-"}`);
          const p = pages[n - 1];
          return {
            bytes: fixture(format === "png" ? "red-40x30.png" : "red-60x20.jpg"),
            widthPt: p.getWidth(),
            heightPt: p.getHeight(),
          };
        },
        async destroy() {
          calls.push("destroy");
        },
      };
    },
  };
}
