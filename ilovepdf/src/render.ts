// pdf.js adapter. The only place that knows about pdf.js and <canvas>; everything in
// src/ops/ sees the Rasterizer interface. pdf.js is loaded lazily by the caller's
// loadPdfjs (a dynamic import in the app, a fake in tests).
import type { ImageFormat, RasterDoc, Rasterizer, RenderOptions } from "./ops/types.ts";

/** The parts of the pdf.js module this app uses. */
export interface PdfjsModule {
  GlobalWorkerOptions: { workerSrc: string };
  /** The loading task. In pdf.js 6 it, not the document, owns destroy(). */
  getDocument(params: object): { promise: Promise<PdfjsDoc>; destroy(): Promise<void> };
}

export interface PdfjsDoc {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfjsPage>;
}

export interface PdfjsPage {
  getViewport(opts: { scale: number }): { width: number; height: number };
  render(opts: { canvas: HTMLCanvasElement; viewport: unknown }): { promise: Promise<void> };
  cleanup(): void;
}

/** Makes canvases and turns them into bytes. The app uses the DOM; tests use a fake. */
export interface Surface {
  createCanvas(width: number, height: number): HTMLCanvasElement;
  encode(canvas: HTMLCanvasElement, format: ImageFormat, quality?: number): Promise<Uint8Array>;
}

/**
 * Absolute URLs for the self-hosted pdf.js files (copied into public/pdfjs/ by vite.plugins.ts).
 * They must be absolute: the worker resolves relative URLs against its own location.
 */
export function pdfjsAssets(baseUrl: string) {
  const at = (path: string) => new URL(`pdfjs/${path}`, baseUrl).href;
  return {
    workerSrc: at("pdf.worker.min.mjs"),
    cMapUrl: at("cmaps/"),
    standardFontDataUrl: at("standard_fonts/"),
    wasmUrl: at("wasm/"),
    iccUrl: at("iccs/"),
  };
}

/**
 * getDocument parameters. `isEvalSupported: false` is always set: pdf.js 6 no longer reads it,
 * but it keeps any build that still has the eval font path from using it, and the page's CSP
 * blocks eval regardless. pdf.js transfers (detaches) the buffer it is given, so it gets a copy.
 */
export function documentParams(data: Uint8Array, baseUrl: string) {
  const { cMapUrl, standardFontDataUrl, wasmUrl, iccUrl } = pdfjsAssets(baseUrl);
  return {
    data: data.slice(),
    isEvalSupported: false,
    cMapUrl,
    cMapPacked: true,
    standardFontDataUrl,
    wasmUrl,
    iccUrl,
    enableXfa: false,
  };
}

export interface PdfjsDeps {
  loadPdfjs: () => Promise<PdfjsModule>;
  baseUrl: string;
  surface: Surface;
}

/** Draws one page into a canvas sized for `scale`. Returns the page's size in points. */
async function drawPage(doc: PdfjsDoc, pageNumber: number, scale: number, canvas: HTMLCanvasElement | null, surface: Surface) {
  const page = await doc.getPage(pageNumber);
  try {
    const pt = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale });
    const target = canvas ?? surface.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    target.width = Math.ceil(viewport.width);
    target.height = Math.ceil(viewport.height);
    await page.render({ canvas: target, viewport }).promise;
    return { canvas: target, widthPt: pt.width, heightPt: pt.height };
  } finally {
    page.cleanup();
  }
}

export interface PreviewDoc {
  numPages: number;
  /** Draw a page into `canvas` so it is `cssWidth` CSS pixels wide at the given pixel ratio. */
  drawThumbnail(pageNumber: number, canvas: HTMLCanvasElement, cssWidth: number, pixelRatio: number): Promise<void>;
  destroy(): Promise<void>;
}

export function createPdfjsRasterizer(deps: PdfjsDeps): Rasterizer & { preview(bytes: Uint8Array): Promise<PreviewDoc> } {
  let lib: Promise<PdfjsModule> | undefined;
  const load = () =>
    (lib ??= deps.loadPdfjs().then((m) => {
      m.GlobalWorkerOptions.workerSrc = pdfjsAssets(deps.baseUrl).workerSrc;
      return m;
    }));
  const openDoc = async (bytes: Uint8Array) => {
    const task = (await load()).getDocument(documentParams(bytes, deps.baseUrl));
    return { doc: await task.promise, destroy: () => task.destroy() };
  };

  return {
    async open(bytes): Promise<RasterDoc> {
      const { doc, destroy } = await openDoc(bytes);
      return {
        numPages: doc.numPages,
        async renderPage(n: number, opts: RenderOptions) {
          const { canvas, widthPt, heightPt } = await drawPage(doc, n, opts.scale, null, deps.surface);
          const bytes = await deps.surface.encode(canvas, opts.format, opts.quality);
          canvas.width = canvas.height = 0; // free the backing store now, not at GC time
          return { bytes, widthPt, heightPt };
        },
        destroy,
      };
    },

    async preview(bytes) {
      const { doc, destroy } = await openDoc(bytes);
      return {
        numPages: doc.numPages,
        async drawThumbnail(n, canvas, cssWidth, pixelRatio) {
          const page = await doc.getPage(n);
          const scale = (cssWidth * pixelRatio) / page.getViewport({ scale: 1 }).width;
          page.cleanup();
          await drawPage(doc, n, scale, canvas, deps.surface);
        },
        destroy,
      };
    },
  };
}

/** The browser Surface: a detached <canvas> per page, encoded with toBlob. */
export const domSurface: Surface = {
  createCanvas(width, height) {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    return c;
  },
  encode(canvas, format, quality) {
    if (format === "jpeg") {
      // JPEG has no alpha: paint white under the page so transparent areas don't turn black.
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.globalCompositeOperation = "destination-over";
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
    return new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject) : reject(new Error("The browser could not encode this page."))),
        format === "png" ? "image/png" : "image/jpeg",
        quality,
      ),
    );
  },
};

/** Re-encode a WebP image as JPEG through a canvas, for embedding in a PDF. */
export async function webpToJpeg(webp: Uint8Array): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(new Blob([webp as BlobPart], { type: "image/webp" }));
  const canvas = domSurface.createCanvas(bitmap.width, bitmap.height);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  bitmap.close();
  return domSurface.encode(canvas, "jpeg", 0.92);
}
