import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { compressLossless, compressRasterise } from "../src/ops/compress.ts";
import { detectImageType, imagesToPdf, pdfToImages } from "../src/ops/images.ts";
import { NotAPdfError, PasswordRequiredError, WrongPasswordError, unlockPdf } from "../src/ops/load.ts";
import { mergePdfs } from "../src/ops/merge.ts";
import { editPages } from "../src/ops/pages.ts";
import { splitEveryPage, splitPdf } from "../src/ops/split.ts";
import { fixture, makePdf, pageWidths, stubRasterizer } from "./helpers.ts";

describe("mergePdfs", () => {
  it("merges a 2-page and a 3-page PDF into 5 pages in order", async () => {
    const out = await mergePdfs([await makePdf(2), await makePdf(3)]);
    expect(await pageWidths(out)).toEqual([100, 101, 100, 101, 102]);
  });

  it("rejects an empty list", async () => {
    await expect(mergePdfs([])).rejects.toThrow(/at least one/i);
  });
});

describe("splitPdf", () => {
  it("splits 1-2,5 from a 5-page PDF into documents of 2 and 1 pages", async () => {
    const parts = await splitPdf(await makePdf(5), "1-2,5");
    expect(parts).toHaveLength(2);
    expect(await pageWidths(parts[0])).toEqual([100, 101]);
    expect(await pageWidths(parts[1])).toEqual([104]);
  });

  it("passes range errors through", async () => {
    await expect(splitPdf(await makePdf(5), "6")).rejects.toThrow(/page 6/);
  });

  it("can split every page into its own document", async () => {
    const parts = await splitEveryPage(await makePdf(3));
    expect(await Promise.all(parts.map(pageWidths))).toEqual([[100], [101], [102]]);
  });
});

describe("editPages", () => {
  it("rotates page 2 by 90 degrees and leaves the other pages alone", async () => {
    const out = await editPages(await makePdf(3), [
      { from: 0, rotate: 0 },
      { from: 1, rotate: 90 },
      { from: 2, rotate: 0 },
    ]);
    const doc = await PDFDocument.load(out);
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([0, 90, 0]);
  });

  it("adds to an existing rotation and wraps at 360", async () => {
    const once = await editPages(await makePdf(1), [{ from: 0, rotate: 270 }]);
    const twice = await editPages(once, [{ from: 0, rotate: 180 }]);
    expect((await PDFDocument.load(twice)).getPage(0).getRotation().angle).toBe(90);
  });

  it("reorders and drops pages", async () => {
    const out = await editPages(await makePdf(4), [
      { from: 3, rotate: 0 },
      { from: 0, rotate: 0 },
    ]);
    expect(await pageWidths(out)).toEqual([103, 100]);
  });

  it("rejects deleting every page", async () => {
    await expect(editPages(await makePdf(3), [])).rejects.toThrow(/at least one page/i);
  });

  it("rejects a page that does not exist", async () => {
    await expect(editPages(await makePdf(2), [{ from: 2, rotate: 0 }])).rejects.toThrow(/page 3/);
  });
});

describe("imagesToPdf", () => {
  it("embeds one page per JPEG and PNG, each sized to its image", async () => {
    const out = await imagesToPdf([fixture("red-60x20.jpg"), fixture("red-40x30.png")]);
    const doc = await PDFDocument.load(out);
    expect(doc.getPages().map((p) => [p.getWidth(), p.getHeight()])).toEqual([
      [60, 20],
      [40, 30],
    ]);
  });

  it("converts WebP to JPEG through the injected encoder before embedding", async () => {
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0, 0, 0]);
    const toJpeg = vi.fn<(b: Uint8Array) => Promise<Uint8Array>>(async () => fixture("red-60x20.jpg"));
    const out = await imagesToPdf([webp], { webpToJpeg: toJpeg });
    expect(toJpeg).toHaveBeenCalledWith(webp);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(1);
  });

  it("refuses WebP when no encoder is available", async () => {
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    await expect(imagesToPdf([webp])).rejects.toThrow(/webp/i);
  });

  it("rejects files that are not JPEG, PNG or WebP", async () => {
    await expect(imagesToPdf([new TextEncoder().encode("GIF89a....")])).rejects.toThrow(/not a jpeg, png or webp/i);
  });

  it("detects image types from their bytes", () => {
    expect(detectImageType(fixture("red-60x20.jpg"))).toBe("jpeg");
    expect(detectImageType(fixture("red-40x30.png"))).toBe("png");
    expect(detectImageType(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe("pdfToImages", () => {
  it("renders every page through the rasteriser and names the files by page", async () => {
    const r = stubRasterizer();
    const progress: number[] = [];
    const images = await pdfToImages(await makePdf(2), r, {
      format: "jpeg",
      scale: 2,
      quality: 0.8,
      onProgress: (done) => progress.push(done),
    });
    expect(images.map((i) => i.name)).toEqual(["page-1.jpg", "page-2.jpg"]);
    expect(r.calls).toEqual(["open:2", "render:1:2:jpeg:0.8", "render:2:2:jpeg:0.8", "destroy"]);
    expect(progress).toEqual([1, 2]);
  });
});

describe("password-protected input", () => {
  it("raises password required when no password is given", async () => {
    const enc = await makePdf(2, { encryptWith: "s3cret" });
    await expect(splitPdf(enc, "1")).rejects.toBeInstanceOf(PasswordRequiredError);
    await expect(mergePdfs([enc])).rejects.toThrow(/password required/i);
  });

  it("raises wrong password for a bad password", async () => {
    const enc = await makePdf(2, { encryptWith: "s3cret" });
    await expect(unlockPdf(enc, "nope")).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it("succeeds with the right password and writes an unencrypted file", async () => {
    const enc = await makePdf(2, { encryptWith: "s3cret" });
    const out = await mergePdfs([{ bytes: enc, password: "s3cret" }, await makePdf(1)]);
    const doc = await PDFDocument.load(out);
    expect(doc.isEncrypted).toBe(false);
    expect(doc.getPageCount()).toBe(3);
  });

  it("unlocks to plain bytes once, for every later step", async () => {
    const enc = await makePdf(3, { encryptWith: "s3cret" });
    const { bytes, pageCount } = await unlockPdf(enc, "s3cret");
    expect(pageCount).toBe(3);
    expect((await PDFDocument.load(bytes)).isEncrypted).toBe(false);
  });

  it("opens an owner-only protected file without asking for a password", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 200]);
    doc.encrypt({ userPassword: "", ownerPassword: "owner" });
    const r = await unlockPdf(await doc.save());
    expect(r.wasEncrypted).toBe(true);
    expect((await PDFDocument.load(r.bytes)).isEncrypted).toBe(false);
  });

  it("names unreadable input as not a PDF", async () => {
    await expect(unlockPdf(new TextEncoder().encode("hello"))).rejects.toBeInstanceOf(NotAPdfError);
  });
});

describe("compressLossless", () => {
  it("reports before and after sizes from the qpdf stub", async () => {
    const input = await makePdf(3);
    const qpdf = vi.fn<(b: Uint8Array) => Promise<Uint8Array>>(async (b) => b.slice(0, b.length - 10));
    const r = await compressLossless(input, qpdf);
    expect(qpdf).toHaveBeenCalledOnce();
    expect(r.before).toBe(input.length);
    expect(r.after).toBe(input.length - 10);
    expect(r.bytes.length).toBe(r.after);
    expect(r.keptOriginal).toBe(false);
  });

  it("never returns a larger file than its input", async () => {
    const input = await makePdf(3);
    const bigger = new Uint8Array(input.length + 500);
    const r = await compressLossless(input, async () => bigger);
    expect(r.bytes).toBe(input);
    expect(r.after).toBe(input.length);
    expect(r.keptOriginal).toBe(true);
  });

  it("decrypts before handing bytes to qpdf", async () => {
    const enc = await makePdf(1, { encryptWith: "pw" });
    let seen: Uint8Array | undefined;
    await compressLossless({ bytes: enc, password: "pw" }, async (b) => {
      seen = b;
      return b;
    });
    expect((await PDFDocument.load(seen!)).isEncrypted).toBe(false);
  });
});

describe("compressRasterise", () => {
  it("rebuilds every page as an image at the original page size", async () => {
    const input = await makePdf(2);
    const r = await compressRasterise(input, stubRasterizer(), { scale: 1.5, quality: 0.6 });
    const doc = await PDFDocument.load(r.bytes);
    expect(doc.getPages().map((p) => Math.round(p.getWidth()))).toEqual([100, 101]);
    expect(r.before).toBe(input.length);
  });
});
