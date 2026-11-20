// What each tool accepts, what it needs before it can run, and how it runs.
// The heavy modules (pdf-lib, pdf.js, qpdf) are imported on first use.
import type { QpdfRunner } from "../ops/compress.ts";
import type { NamedFile } from "../ops/images.ts";
import type { PageEdit } from "../ops/pages.ts";
import type { PageRange } from "../ops/ranges.ts";
import type { ImageFormat, Progress, Rasterizer } from "../ops/types.ts";

export type ToolId = "merge" | "split" | "organise" | "images" | "topng" | "compress";

export interface ToolInfo {
  id: ToolId;
  label: string;
  blurb: string;
  accepts: "pdf" | "image";
  /** More than one input file. */
  multiple: boolean;
  minFiles: number;
  runLabel: string;
}

export const TOOLS: ToolInfo[] = [
  { id: "merge", label: "Merge", blurb: "Join several PDFs into one, in the order you set.", accepts: "pdf", multiple: true, minFiles: 2, runLabel: "Merge PDFs" },
  { id: "split", label: "Split", blurb: "Pull page ranges out of a PDF, or split it into single pages.", accepts: "pdf", multiple: false, minFiles: 1, runLabel: "Split PDF" },
  { id: "organise", label: "Organise", blurb: "Reorder, rotate and delete pages using thumbnails.", accepts: "pdf", multiple: false, minFiles: 1, runLabel: "Save PDF" },
  { id: "images", label: "Images to PDF", blurb: "Turn JPEG, PNG and WebP images into a PDF, one page per image.", accepts: "image", multiple: true, minFiles: 1, runLabel: "Make PDF" },
  { id: "topng", label: "PDF to images", blurb: "Export every page of a PDF as a PNG or JPEG image.", accepts: "pdf", multiple: false, minFiles: 1, runLabel: "Export images" },
  { id: "compress", label: "Compress", blurb: "Make a PDF smaller, keeping text selectable or turning pages into images.", accepts: "pdf", multiple: false, minFiles: 1, runLabel: "Compress PDF" },
];

export interface Options {
  splitMode: "ranges" | "every";
  ranges: string;
  imageFormat: ImageFormat;
  dpi: 72 | 150 | 300;
  compressMode: "lossless" | "rasterise";
  rasterPreset: "balanced" | "strong";
}

export const defaultOptions = (): Options => ({
  splitMode: "ranges",
  ranges: "",
  imageFormat: "png",
  dpi: 150,
  compressMode: "lossless",
  rasterPreset: "balanced",
});

export const RASTER_PRESETS = {
  balanced: { scale: 150 / 72, quality: 0.75, label: "Balanced: 150 dpi, good for reading on screen" },
  strong: { scale: 100 / 72, quality: 0.6, label: "Smallest: 100 dpi, softer images" },
} as const;

export interface RunInput {
  /** Unencrypted bytes of each ready input, in order. */
  inputs: { name: string; bytes: Uint8Array; pageCount?: number }[];
  options: Options;
  pages: PageEdit[];
  onProgress: Progress;
}

export interface RunResult {
  files: NamedFile[];
  /** Name for the zip offered when there is more than one file. */
  zipName?: string;
  /** Compression keeps the original when it can't make it smaller. */
  keptOriginal?: boolean;
}

export interface Engines {
  rasterizer: () => Promise<Rasterizer>;
  qpdf: () => QpdfRunner;
  webpToJpeg: (b: Uint8Array) => Promise<Uint8Array>;
}

const stem = (name: string) => name.replace(/\.[^.]+$/, "") || "document";

/** Throws a user-facing Error for anything the options make impossible. */
export async function runTool(id: ToolId, input: RunInput, engines: Engines): Promise<RunResult> {
  const first = input.inputs[0];
  const base = first ? stem(first.name) : "document";
  const opts = input.options;
  switch (id) {
    case "merge": {
      const { mergePdfs } = await import("../ops/merge.ts");
      return { files: [{ name: "merged.pdf", bytes: await mergePdfs(input.inputs.map((f) => f.bytes)) }] };
    }
    case "split": {
      const { splitPdf, splitEveryPage } = await import("../ops/split.ts");
      if (opts.splitMode === "every") {
        const parts = await splitEveryPage(first.bytes);
        return { files: parts.map((bytes, i) => ({ name: `${base}-page-${i + 1}.pdf`, bytes })), zipName: `${base}-pages.zip` };
      }
      const parts = await splitPdf(first.bytes, opts.ranges);
      const label = ({ start, end }: PageRange) => (start === end ? `${start}` : `${start}-${end}`);
      return {
        files: parts.map(({ range, bytes }) => ({ name: `${base}-pages-${label(range)}.pdf`, bytes })),
        zipName: `${base}-split.zip`,
      };
    }
    case "organise": {
      const { editPages } = await import("../ops/pages.ts");
      return { files: [{ name: `${base}-organised.pdf`, bytes: await editPages(first.bytes, input.pages) }] };
    }
    case "images": {
      const { imagesToPdf } = await import("../ops/images.ts");
      const bytes = await imagesToPdf(
        input.inputs.map((f) => f.bytes),
        { webpToJpeg: engines.webpToJpeg, onProgress: input.onProgress },
      );
      return { files: [{ name: input.inputs.length === 1 ? `${base}.pdf` : "images.pdf", bytes }] };
    }
    case "topng": {
      const { pdfToImages } = await import("../ops/images.ts");
      const files = await pdfToImages(first.bytes, await engines.rasterizer(), {
        format: opts.imageFormat,
        scale: opts.dpi / 72,
        quality: 0.9,
        onProgress: input.onProgress,
      });
      return { files: files.map((f) => ({ ...f, name: `${base}-${f.name}` })), zipName: `${base}-images.zip` };
    }
    case "compress": {
      const { compressLossless, compressRasterise } = await import("../ops/compress.ts");
      const r =
        opts.compressMode === "lossless"
          ? await compressLossless(first.bytes, engines.qpdf())
          : await compressRasterise(first.bytes, await engines.rasterizer(), {
              ...RASTER_PRESETS[opts.rasterPreset],
              onProgress: input.onProgress,
            });
      return { files: [{ name: `${base}-compressed.pdf`, bytes: r.bytes }], keptOriginal: r.keptOriginal };
    }
  }
}
