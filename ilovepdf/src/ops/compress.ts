import { PDFDocument } from "@cantoo/pdf-lib";
import { sourceBytes, unlockPdf } from "./load.ts";
import type { CompressResult, PdfSource, Progress, Rasterizer } from "./types.ts";

/** Runs qpdf over unencrypted PDF bytes and returns the rewritten file. */
export type QpdfRunner = (pdf: Uint8Array) => Promise<Uint8Array>;

/** The qpdf arguments for the lossless mode: object streams, recompressed streams, unused objects dropped. */
export const LOSSLESS_ARGS = [
  "--object-streams=generate",
  "--compress-streams=y",
  "--recompress-flate",
  "--compression-level=9",
  "--remove-unreferenced-resources=yes",
] as const;

function smaller(src: PdfSource, base: Uint8Array, candidate: Uint8Array): CompressResult {
  const before = sourceBytes(src).length;
  const keptOriginal = candidate.length >= base.length;
  const bytes = keptOriginal ? base : candidate;
  return { bytes, before, after: bytes.length, keptOriginal };
}

/**
 * Rewrite the file without touching its content, so text stays selectable.
 * Never returns a file larger than the (decrypted) input.
 */
export async function compressLossless(src: PdfSource, qpdf: QpdfRunner): Promise<CompressResult> {
  const { bytes } = await unlockPdf(src);
  return smaller(src, bytes, await qpdf(bytes));
}

export interface RasteriseOptions {
  /** Render scale; 1.5 is about 108 dpi. */
  scale: number;
  /** JPEG quality, 0..1. */
  quality: number;
  onProgress?: Progress;
}

/**
 * Replace every page with a JPEG of itself at the same page size. Much smaller for scans and
 * image-heavy files, but text stops being selectable and links stop working.
 */
export async function compressRasterise(
  src: PdfSource,
  rasterizer: Rasterizer,
  opts: RasteriseOptions,
): Promise<CompressResult> {
  const { bytes } = await unlockPdf(src);
  const doc = await rasterizer.open(bytes);
  const out = await PDFDocument.create();
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.renderPage(n, { scale: opts.scale, format: "jpeg", quality: opts.quality });
      const image = await out.embedJpg(page.bytes);
      out.addPage([page.widthPt, page.heightPt]).drawImage(image, {
        x: 0,
        y: 0,
        width: page.widthPt,
        height: page.heightPt,
      });
      opts.onProgress?.(n, doc.numPages);
    }
  } finally {
    await doc.destroy();
  }
  return smaller(src, bytes, await out.save());
}
