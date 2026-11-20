# pdf-tools

The everyday PDF jobs, done in a browser tab: merge, split, reorder, rotate and
delete pages, turn images into a PDF, export pages as images, and compress.
Inspired by iLovePDF, but nothing is uploaded anywhere. Your files are read,
changed and saved on your own device, and the page says so the whole time.

Vite + TypeScript with no UI framework. Editing is done with
[`@cantoo/pdf-lib`](https://github.com/cantoo-scribe/pdf-lib), page rendering
with [pdf.js](https://mozilla.github.io/pdf.js/), and lossless compression with
[qpdf compiled to WebAssembly](https://github.com/neslinesli93/qpdf-wasm).

## Quick start

Requires Node 22 or newer and pnpm 10.

```bash
pnpm install
pnpm dev        # http://localhost:5173
```

```bash
pnpm test       # vitest: the PDF operations, page ranges, pdf.js adapter, password flow, downloads, CSP
pnpm lint       # oxlint
pnpm build      # type check and build into dist/
pnpm preview    # serve dist/ locally
```

`pnpm dev` runs without the Content-Security-Policy (see Security below), so
check CSP-related changes with `pnpm build && pnpm preview`.

## Configuration

None. There is no `.env`, no server and no account. Everything the app needs,
including the pdf.js worker, fonts and character maps and the qpdf WebAssembly
file, is served from the same folder as the page.

## The tools

| Tool | What it does |
|---|---|
| Merge | Joins two or more PDFs. Drag the files to set the order. |
| Split | Extracts page ranges such as `1-3,5,8-` (one PDF per range, `8-` means "to the end"), or splits every page into its own PDF. |
| Organise | Shows a thumbnail per page. Drag to reorder, turn pages left or right, delete pages. |
| Images to PDF | JPEG, PNG and WebP images become one page each, sized to the image. WebP is re-encoded as JPEG first, because PDF cannot hold WebP. |
| PDF to images | Every page as a PNG or JPEG at 72, 150 or 300 dpi. |
| Compress | **Lossless** rewrites the file with qpdf (object streams, recompressed streams, unused resources dropped), so text stays selectable. **Rasterise** redraws every page as a JPEG, which shrinks scans a lot but removes selectable text, links and form fields. The app warns about this before it runs. Neither mode ever hands back a file bigger than the one you gave it. |

When a tool produces several files you can download them one by one or as a
single `.zip`.

### Password-protected PDFs

When you add a protected PDF the app asks for its password. A wrong password
asks again with an error, and **Remove file** drops it. The check happens in the
browser. Files that only have an owner password (printing or copying
restrictions, no password to open) load without asking. Whatever you save from a
protected file is written without encryption.

## How it works

```
index.html, src/main.ts     the page: tabs, file list, options, results, password dialog
src/ui/                     tools.ts (what each tool runs), thumbnails.ts, intake.ts,
                            download.ts, zip.ts, dom.ts
src/ops/                    the PDF operations, with no DOM: merge, split, pages, images,
                            compress, ranges, load (passwords)
src/render.ts               the only code that touches pdf.js and <canvas>
src/qpdf.worker.ts          runs qpdf in a Web Worker
vite.plugins.ts             the CSP meta tag, and copying vendor files into public/
```

- **Operations are pure.** Everything in `src/ops/` takes bytes and options and
  returns bytes. Drawing pages is behind a small `Rasterizer` interface, which
  the app backs with pdf.js and a canvas and the tests replace with a stub.
- **Heavy code loads late.** The first screen is about 22 kB of script.
  pdf-lib loads when you add a file, pdf.js when a tool needs to draw pages, and
  qpdf (1.3 MB of WebAssembly, in its own worker) only when you run lossless
  compression.
- **Self-hosted vendor files.** On `dev` and `build`, `vite.plugins.ts` copies
  the pdf.js worker, cMaps, standard fonts, wasm decoders and ICC profiles to
  `public/pdfjs/`, and `qpdf.wasm` to `public/qpdf/`, from the pinned packages
  in `node_modules`. Those folders are git-ignored.
- **Passwords are asked for once.** When a protected file is added it is
  decrypted with pdf-lib, and from then on the app keeps only the unencrypted
  copy in memory. pdf.js and qpdf never see a password.

## Deploying

The build is a static folder. Any static host works, and it can live under a
sub-path:

```bash
pnpm build --base=./
# upload dist/
```

The vibe hub builds it exactly this way and serves it at `/vibe/ilovepdf/`.

## Security notes

- **No uploads.** The page makes no requests except for its own files.
  `connect-src 'self' blob:` enforces that.
- **Strict CSP, as a meta tag.** Static hosts such as GitHub Pages cannot send
  headers, so the built `index.html` carries:

  ```
  default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:;
  img-src 'self' blob: data:; connect-src 'self' blob:; style-src 'self';
  object-src 'none'; base-uri 'none'
  ```

  `'wasm-unsafe-eval'` lets WebAssembly compile. There is no `'unsafe-inline'`
  and no `'unsafe-eval'`. Styling lives in a stylesheet file, and the code never
  writes `style=""` attributes. A meta tag cannot set `frame-ancestors`, so if
  you host this yourself and care about framing, send that as a header. The tag
  is added only by the production build. Vite's dev server injects CSS as
  `<style>` elements, which this policy would block.
- **pdf.js runs with `isEvalSupported: false`** and with XFA forms off. The
  app never runs a PDF's own JavaScript.
- **Downloads use blob URLs**, and each one is revoked shortly after its
  download starts.
- **Memory, not storage.** Files live in the tab's memory only. Nothing goes to
  `localStorage`, IndexedDB or a cache. Closing the tab discards them.

## Out of scope

- OCR, editing text, signing, filling forms, watermarks, page numbers.
- Office formats (Word, Excel, PowerPoint) in either direction.
- Adding a password to a PDF.
- Keyboard controls for moving pages. Reordering is drag-and-drop. Turning and
  deleting pages are ordinary buttons.
- Very large files. Everything happens in browser memory, so a phone may
  struggle with a PDF of a few hundred megabytes.
