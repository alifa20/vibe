import { PDFDocument } from "@cantoo/pdf-lib";
import { unlockPdf } from "./load.ts";
import type { ImageFormat, PdfSource, Progress, Rasterizer } from "./types.ts";

export type ImageType = "jpeg" | "png" | "webp";

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);

/** Identify an image from its first bytes, not its file name. */
export function detectImageType(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "webp";
  return null;
}

export interface ImagesToPdfOptions {
  /** Re-encodes WebP as JPEG (PDF cannot hold WebP). The app passes a canvas encoder. */
  webpToJpeg?: (webp: Uint8Array) => Promise<Uint8Array>;
  onProgress?: Progress;
}

/** One page per image, each page the image's pixel size in points. */
export async function imagesToPdf(images: Uint8Array[], opts: ImagesToPdfOptions = {}): Promise<Uint8Array> {
  if (images.length === 0) throw new Error("Add at least one image.");
  const out = await PDFDocument.create();
  for (const [i, raw] of images.entries()) {
    const type = detectImageType(raw);
    if (!type) throw new Error(`Image ${i + 1} is not a JPEG, PNG or WebP file.`);
    let image;
    if (type === "png") image = await out.embedPng(raw);
    else if (type === "jpeg") image = await out.embedJpg(raw);
    else {
      if (!opts.webpToJpeg) throw new Error("WebP images need a browser that can convert them.");
      image = await out.embedJpg(await opts.webpToJpeg(raw));
    }
    const page = out.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
    opts.onProgress?.(i + 1, images.length);
  }
  return out.save();
}

export interface PdfToImagesOptions {
  format: ImageFormat;
  scale: number;
  quality?: number;
  onProgress?: Progress;
}

export interface NamedFile {
  name: string;
  bytes: Uint8Array;
}

/** Render every page as a PNG or JPEG, named page-1.png, page-2.png, and so on. */
export async function pdfToImages(src: PdfSource, rasterizer: Rasterizer, opts: PdfToImagesOptions): Promise<NamedFile[]> {
  const { bytes } = await unlockPdf(src);
  const doc = await rasterizer.open(bytes);
  const ext = opts.format === "png" ? "png" : "jpg";
  try {
    const files: NamedFile[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.renderPage(n, { scale: opts.scale, format: opts.format, quality: opts.quality });
      files.push({ name: `page-${n}.${ext}`, bytes: page.bytes });
      opts.onProgress?.(n, doc.numPages);
    }
    return files;
  } finally {
    await doc.destroy();
  }
}
