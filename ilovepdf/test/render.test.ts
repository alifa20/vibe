import { describe, expect, it } from "vitest";
import { type PdfjsModule, createPdfjsRasterizer, documentParams, pdfjsAssets } from "../src/render.ts";

const BASE = "https://alifa20.github.io/vibe/ilovepdf/";

function fakePdfjs() {
  const seen: { params: Record<string, unknown>[]; renders: unknown[]; destroyed: number } = {
    params: [],
    renders: [],
    destroyed: 0,
  };
  const lib: PdfjsModule = {
    GlobalWorkerOptions: { workerSrc: "" },
    getDocument(params) {
      seen.params.push(params as Record<string, unknown>);
      return {
        promise: Promise.resolve({
          numPages: 2,
          async getPage(n: number) {
            return {
              getViewport: ({ scale }: { scale: number }) => ({ width: 100 * n * scale, height: 50 * scale }),
              render(p: unknown) {
                seen.renders.push(p);
                return { promise: Promise.resolve() };
              },
              cleanup() {},
            };
          },
        }),
        // pdf.js 6: the document proxy has no destroy(); the loading task owns teardown.
        async destroy() {
          seen.destroyed++;
        },
      };
    },
  };
  return { lib, seen };
}

const fakeSurface = () => {
  const made: { width: number; height: number }[] = [];
  return {
    made,
    createCanvas(width: number, height: number) {
      made.push({ width, height });
      return { width, height } as unknown as HTMLCanvasElement;
    },
    async encode(_c: HTMLCanvasElement, format: string, quality?: number) {
      return new TextEncoder().encode(`${format}:${quality ?? "-"}`);
    },
  };
};

describe("pdf.js adapter", () => {
  it("points every asset at the self-hosted copies, as absolute URLs", () => {
    expect(pdfjsAssets(BASE)).toEqual({
      workerSrc: `${BASE}pdfjs/pdf.worker.min.mjs`,
      cMapUrl: `${BASE}pdfjs/cmaps/`,
      standardFontDataUrl: `${BASE}pdfjs/standard_fonts/`,
      wasmUrl: `${BASE}pdfjs/wasm/`,
      iccUrl: `${BASE}pdfjs/iccs/`,
    });
  });

  it("always passes isEvalSupported: false and the self-hosted URLs", () => {
    const data = new Uint8Array([1, 2, 3]);
    const p = documentParams(data, BASE);
    expect(p.isEvalSupported).toBe(false);
    expect(p.cMapUrl).toBe(`${BASE}pdfjs/cmaps/`);
    expect(p.cMapPacked).toBe(true);
    expect(p.standardFontDataUrl).toBe(`${BASE}pdfjs/standard_fonts/`);
    expect(p.wasmUrl).toBe(`${BASE}pdfjs/wasm/`);
    expect(p.enableXfa).toBe(false);
  });

  it("hands pdf.js a copy of the bytes, since pdf.js detaches what it is given", () => {
    const data = new Uint8Array([1, 2, 3]);
    const p = documentParams(data, BASE);
    expect(p.data).toEqual(data);
    expect((p.data as Uint8Array).buffer).not.toBe(data.buffer);
  });

  it("sets the worker source and opens documents with those params", async () => {
    const { lib, seen } = fakePdfjs();
    const r = createPdfjsRasterizer({ loadPdfjs: async () => lib, baseUrl: BASE, surface: fakeSurface() });
    const doc = await r.open(new Uint8Array([9]));
    expect(lib.GlobalWorkerOptions.workerSrc).toBe(`${BASE}pdfjs/pdf.worker.min.mjs`);
    expect(seen.params[0]).toMatchObject({ isEvalSupported: false, cMapUrl: `${BASE}pdfjs/cmaps/` });
    expect(doc.numPages).toBe(2);
  });

  it("renders a page at the requested scale and reports its size in points", async () => {
    const { lib, seen } = fakePdfjs();
    const surface = fakeSurface();
    const r = createPdfjsRasterizer({ loadPdfjs: async () => lib, baseUrl: BASE, surface });
    const doc = await r.open(new Uint8Array([9]));
    const page = await doc.renderPage(2, { scale: 2, format: "jpeg", quality: 0.7 });
    expect(surface.made[0]).toMatchObject({ width: 400, height: 100 });
    expect(seen.renders).toHaveLength(1);
    expect(page).toMatchObject({ widthPt: 200, heightPt: 50 });
    expect(new TextDecoder().decode(page.bytes)).toBe("jpeg:0.7");
    await doc.destroy();
    expect(seen.destroyed).toBe(1);
  });

  it("loads pdf.js only once", async () => {
    const { lib } = fakePdfjs();
    let loads = 0;
    const r = createPdfjsRasterizer({
      loadPdfjs: async () => {
        loads++;
        return lib;
      },
      baseUrl: BASE,
      surface: fakeSurface(),
    });
    await r.open(new Uint8Array([1]));
    await r.open(new Uint8Array([2]));
    expect(loads).toBe(1);
  });
});
