import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

/**
 * The page's Content-Security-Policy. GitHub Pages cannot send headers, so it ships as a
 * <meta>, which cannot carry frame-ancestors. 'wasm-unsafe-eval' lets qpdf's WebAssembly
 * compile; nothing allows inline script or eval.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "img-src 'self' blob: data:",
  "connect-src 'self' blob:",
  "style-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
].join("; ");

/**
 * Adds the CSP meta to the built index.html only. The dev server injects CSS as <style>
 * elements, which this policy would block, so `pnpm dev` runs without it.
 */
export function cspMeta(): Plugin {
  return {
    name: "pdf-tools:csp-meta",
    apply: "build",
    transformIndexHtml: () => [
      { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CSP }, injectTo: "head-prepend" },
    ],
  };
}

const ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * Copies the pdf.js worker, cMaps, standard fonts, wasm decoders and ICC profiles, and the
 * qpdf wasm, from node_modules into public/ so the app serves them itself. They are
 * build outputs of the pinned dependencies, so they are git-ignored rather than committed.
 */
export function selfHostVendorFiles(): Plugin {
  const copies: [string, string][] = [
    ["node_modules/pdfjs-dist/build/pdf.worker.min.mjs", "public/pdfjs/pdf.worker.min.mjs"],
    ["node_modules/pdfjs-dist/cmaps", "public/pdfjs/cmaps"],
    ["node_modules/pdfjs-dist/standard_fonts", "public/pdfjs/standard_fonts"],
    ["node_modules/pdfjs-dist/wasm", "public/pdfjs/wasm"],
    ["node_modules/pdfjs-dist/iccs", "public/pdfjs/iccs"],
    ["node_modules/pdfjs-dist/LICENSE", "public/pdfjs/LICENSE"],
    ["node_modules/@neslinesli93/qpdf-wasm/dist/qpdf.wasm", "public/qpdf/qpdf.wasm"],
    ["node_modules/@neslinesli93/qpdf-wasm/LICENSE", "public/qpdf/LICENSE"],
  ];
  return {
    name: "pdf-tools:self-host-vendor-files",
    config() {
      for (const [from, to] of copies) {
        mkdirSync(dirname(join(ROOT, to)), { recursive: true });
        cpSync(join(ROOT, from), join(ROOT, to), { recursive: true });
      }
    },
  };
}
