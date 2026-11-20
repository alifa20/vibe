/** A PDF as bytes, or bytes plus the password that opens them. */
export type PdfSource = Uint8Array | { bytes: Uint8Array; password?: string };

export type ImageFormat = "png" | "jpeg";

export interface RenderOptions {
  /** 1 renders a page at 72 dpi (one pixel per point). */
  scale: number;
  format: ImageFormat;
  /** JPEG quality, 0..1. Ignored for PNG. */
  quality?: number;
}

export interface RenderedPage {
  bytes: Uint8Array;
  /** The page's displayed size in points, after its rotation. */
  widthPt: number;
  heightPt: number;
}

/** An open document that can draw its pages to image bytes. */
export interface RasterDoc {
  numPages: number;
  /** `pageNumber` is 1-based. */
  renderPage(pageNumber: number, opts: RenderOptions): Promise<RenderedPage>;
  destroy(): Promise<void>;
}

/**
 * Turns PDF pages into images. The app backs this with pdf.js and a canvas
 * (src/render.ts); tests use a stub. The bytes it receives are never encrypted.
 */
export interface Rasterizer {
  open(bytes: Uint8Array): Promise<RasterDoc>;
}

export type Progress = (done: number, total: number) => void;

/** Size report for a compression run. `keptOriginal` means the output would have been larger. */
export interface CompressResult {
  bytes: Uint8Array;
  before: number;
  after: number;
  keptOriginal: boolean;
}
