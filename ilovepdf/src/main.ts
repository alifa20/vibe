import "./style.css";
import type { PageEdit } from "./ops/pages.ts";
import { parseRanges } from "./ops/ranges.ts";
import { looksLikePdf } from "./ops/sniff.ts";
import type { Rasterizer } from "./ops/types.ts";
import type { PdfjsModule, PreviewDoc } from "./render.ts";
import { h } from "./ui/dom.ts";
import { downloadBytes, formatBytes, mimeFor } from "./ui/download.ts";
import type { PageGrid } from "./ui/thumbnails.ts";
import { type Engines, type Options, RASTER_PRESETS, type RunResult, TOOLS, type ToolId, type ToolInfo, defaultOptions, runTool } from "./ui/tools.ts";

// ---------------------------------------------------------------------------------------------
// State

interface FileItem {
  id: number;
  name: string;
  size: number;
  status: "loading" | "ready" | "error";
  bytes?: Uint8Array;
  pageCount?: number;
  wasEncrypted?: boolean;
  error?: string;
}

interface ToolState {
  files: FileItem[];
  options: Options;
  pages: PageEdit[];
  grid?: PageGrid;
  gridFor?: number;
  running: boolean;
  progress?: { done: number; total: number };
  result?: RunResult & { before: number; after: number };
  error?: string;
}

const states = new Map<ToolId, ToolState>(
  TOOLS.map((t) => [t.id, { files: [], options: defaultOptions(), pages: [], running: false }]),
);
let current: ToolId = "merge";
let nextId = 1;

const info = (): ToolInfo => TOOLS.find((t) => t.id === current)!;
const state = (): ToolState => states.get(current)!;

// ---------------------------------------------------------------------------------------------
// Engines: pdf.js, qpdf and the canvas WebP encoder, all loaded on first use.

const BASE_URL = new URL(import.meta.env.BASE_URL, document.baseURI).href;
let rasterizer: Promise<Rasterizer & { preview(b: Uint8Array): Promise<PreviewDoc> }> | undefined;

const getRasterizer = () =>
  (rasterizer ??= import("./render.ts").then(({ createPdfjsRasterizer, domSurface }) =>
    createPdfjsRasterizer({
      loadPdfjs: () => import("pdfjs-dist") as unknown as Promise<PdfjsModule>,
      baseUrl: BASE_URL,
      surface: domSurface,
    }),
  ));

const engines: Engines = {
  rasterizer: getRasterizer,
  qpdf: () => async (bytes) => (await import("./qpdf.ts")).createQpdfRunner(BASE_URL)(bytes),
  webpToJpeg: async (b) => (await import("./render.ts")).webpToJpeg(b),
};

// ---------------------------------------------------------------------------------------------
// Live regions and the password dialog (both in index.html)

const live = document.getElementById("live")!;
const alertRegion = document.getElementById("alerts")!;

function announce(message: string): void {
  live.textContent = "";
  queueMicrotask(() => (live.textContent = message));
}

function announceError(message: string): void {
  alertRegion.textContent = "";
  queueMicrotask(() => (alertRegion.textContent = message));
}

const dialog = document.getElementById("pw-dialog") as HTMLDialogElement;
const pwForm = document.getElementById("pw-form") as HTMLFormElement;
const pwInput = document.getElementById("pw-input") as HTMLInputElement;
const pwFile = document.getElementById("pw-file")!;
const pwError = document.getElementById("pw-error")!;
let passwordQueue: Promise<unknown> = Promise.resolve();

/** One dialog at a time: each encrypted file waits for the previous prompt to finish. */
function askPassword(fileName: string, error?: string): Promise<string | null> {
  const ask = () =>
    new Promise<string | null>((resolve) => {
      pwFile.textContent = fileName;
      pwError.textContent = error ?? "";
      pwError.hidden = !error;
      pwInput.value = "";
      pwInput.setAttribute("aria-invalid", error ? "true" : "false");
      const finish = (value: string | null) => {
        pwForm.removeEventListener("submit", onSubmit);
        dialog.removeEventListener("cancel", onCancel);
        cancelButton.removeEventListener("click", onCancelClick);
        if (dialog.open) dialog.close();
        resolve(value);
      };
      const onSubmit = (e: Event) => {
        e.preventDefault();
        finish(pwInput.value);
      };
      const onCancel = (e: Event) => {
        e.preventDefault();
        finish(null);
      };
      const onCancelClick = () => finish(null);
      const cancelButton = document.getElementById("pw-cancel")!;
      pwForm.addEventListener("submit", onSubmit);
      dialog.addEventListener("cancel", onCancel);
      cancelButton.addEventListener("click", onCancelClick);
      dialog.showModal();
      pwInput.focus();
    });
  const turn = passwordQueue.then(ask, ask);
  passwordQueue = turn;
  return turn;
}

// ---------------------------------------------------------------------------------------------
// Adding files

const isPdfName = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

async function addFiles(list: FileList | File[]): Promise<void> {
  const tool = info();
  const s = state();
  let files = Array.from(list);
  if (!files.length) return;
  if (!tool.multiple) {
    files = files.slice(0, 1);
    clearGrid(s);
    s.files = [];
  }
  s.result = undefined;
  s.error = undefined;
  const items = files.map<FileItem>((f) => ({ id: nextId++, name: f.name, size: f.size, status: "loading" }));
  s.files.push(...items);
  render();
  announce(`Reading ${files.length === 1 ? files[0].name : `${files.length} files`}.`);
  await Promise.all(files.map((f, i) => readOne(tool, s, items[i], f)));
}

async function readOne(tool: ToolInfo, s: ToolState, item: FileItem, file: File): Promise<void> {
  const fail = (reason: string) => {
    item.status = "error";
    item.error = reason;
    announceError(reason);
    render();
  };
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (tool.accepts === "image") {
      const { detectImageType } = await import("./ops/images.ts");
      if (!detectImageType(bytes)) return fail(`${file.name}: this is not a JPEG, PNG or WebP image.`);
      Object.assign(item, { status: "ready", bytes });
    } else {
      if (!isPdfName(file) && !looksLikePdf(bytes)) {
        return fail(`${file.name}: this file is not a PDF.`);
      }
      const { IntakeCancelled, readPdfFile } = await import("./ui/intake.ts");
      try {
        const r = await readPdfFile(file.name, bytes, askPassword);
        Object.assign(item, { status: "ready", bytes: r.bytes, pageCount: r.pageCount, wasEncrypted: r.wasEncrypted });
      } catch (e) {
        if (e instanceof IntakeCancelled) {
          s.files = s.files.filter((f) => f !== item);
          announce(`${file.name} was removed.`);
          render();
          return;
        }
        throw e;
      }
    }
    announce(`${file.name} is ready${item.pageCount ? `, ${item.pageCount} pages` : ""}.`);
    render();
  } catch (e) {
    fail(e instanceof Error ? e.message : `${file.name}: could not be read.`);
  }
}

function clearGrid(s: ToolState): void {
  s.grid?.destroy();
  s.grid = undefined;
  s.gridFor = undefined;
  s.pages = [];
}

function removeFile(id: number): void {
  const s = state();
  const item = s.files.find((f) => f.id === id);
  s.files = s.files.filter((f) => f.id !== id);
  if (s.gridFor === id) clearGrid(s);
  s.result = undefined;
  if (item) announce(`${item.name} was removed.`);
  render();
}

function moveFile(from: number, to: number): void {
  const s = state();
  if (from === to || from < 0 || to < 0) return;
  const [moved] = s.files.splice(from, 1);
  s.files.splice(to, 0, moved);
  s.result = undefined;
  render();
}

// ---------------------------------------------------------------------------------------------
// Running a tool

function rangeProblem(spec: string, pageCount: number): string | null {
  try {
    parseRanges(spec, pageCount);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

const readyFiles = (s: ToolState) => s.files.filter((f) => f.status === "ready");

function blockReason(tool: ToolInfo, s: ToolState): string | null {
  const ready = readyFiles(s);
  if (s.files.some((f) => f.status === "loading")) return "Waiting for files to load.";
  if (ready.length < tool.minFiles) {
    if (tool.id === "merge") return "Add at least two PDFs.";
    return tool.accepts === "image" ? "Add at least one image." : "Add a PDF.";
  }
  if (tool.id === "split" && s.options.splitMode === "ranges") {
    if (!s.options.ranges.trim()) return "Enter the pages to extract.";
    const count = ready[0]?.pageCount;
    if (count && rangeProblem(s.options.ranges, count)) return "Fix the page ranges first.";
  }
  if (tool.id === "organise" && !s.grid) return "Loading page thumbnails.";
  return null;
}

async function run(): Promise<void> {
  const tool = info();
  const s = state();
  if (s.running || blockReason(tool, s)) return;
  const inputs = readyFiles(s).map((f) => ({ name: f.name, bytes: f.bytes!, pageCount: f.pageCount }));
  s.running = true;
  s.error = undefined;
  s.result = undefined;
  s.progress = undefined;
  render();
  announce(`${tool.runLabel}: working.`);
  try {
    const result = await runTool(tool.id, {
      inputs,
      options: s.options,
      pages: s.pages,
      onProgress: (done, total) => {
        s.progress = { done, total };
        updateProgress();
      },
    }, engines);
    const before = readyFiles(s).reduce((n, f) => n + f.size, 0);
    const after = result.files.reduce((n, f) => n + f.bytes.length, 0);
    s.result = { ...result, before, after };
    announce(`Done. ${result.files.length === 1 ? result.files[0].name : `${result.files.length} files`} ready to download.`);
  } catch (e) {
    s.error = e instanceof Error ? e.message : String(e);
    announceError(s.error);
  } finally {
    s.running = false;
    s.progress = undefined;
    render();
  }
}

let progressEl: HTMLProgressElement | null = null;
function updateProgress(): void {
  const p = state().progress;
  if (!progressEl || !p) return;
  progressEl.max = p.total;
  progressEl.value = p.done;
  progressEl.textContent = `${p.done} of ${p.total}`;
}

// ---------------------------------------------------------------------------------------------
// Rendering

const tabs = document.getElementById("tabs")!;
const panel = document.getElementById("panel")!;

function renderTabs(): void {
  tabs.replaceChildren(
    ...TOOLS.map((t) =>
      h("button", {
        type: "button",
        role: "tab",
        id: `tab-${t.id}`,
        class: "tab",
        "aria-selected": t.id === current ? "true" : "false",
        "aria-controls": "panel",
        tabindex: t.id === current ? "0" : "-1",
        onclick: () => selectTool(t.id),
        onkeydown: ((e: KeyboardEvent) => {
          const i = TOOLS.findIndex((x) => x.id === current);
          const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
          if (!step) return;
          e.preventDefault();
          selectTool(TOOLS[(i + step + TOOLS.length) % TOOLS.length].id);
          document.getElementById(`tab-${current}`)?.focus();
        }) as EventListener,
      }, t.label),
    ),
  );
}

function selectTool(id: ToolId): void {
  current = id;
  renderTabs();
  render();
}

const fileInput = h("input", { type: "file", class: "visually-hidden", tabindex: "-1", "aria-hidden": "true" });
fileInput.addEventListener("change", () => {
  if (fileInput.files) void addFiles(fileInput.files);
  fileInput.value = "";
});

function dropZone(tool: ToolInfo, hasFiles: boolean): HTMLElement {
  const kind = tool.accepts === "image" ? (tool.multiple ? "images" : "an image") : tool.multiple ? "PDFs" : "a PDF";
  const pick = () => {
    fileInput.accept = tool.accepts === "image" ? "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" : "application/pdf,.pdf";
    fileInput.multiple = tool.multiple;
    fileInput.click();
  };
  const zone = h(
    "div",
    {
      class: `drop-zone${hasFiles ? " is-compact" : ""}`,
      ondragover: ((e: DragEvent) => {
        if (!e.dataTransfer?.types.includes("Files")) return;
        e.preventDefault();
        zone.classList.add("is-over");
      }) as EventListener,
      ondragleave: () => zone.classList.remove("is-over"),
      ondrop: ((e: DragEvent) => {
        if (!e.dataTransfer?.files.length) return;
        e.preventDefault();
        zone.classList.remove("is-over");
        void addFiles(e.dataTransfer.files);
      }) as EventListener,
    },
    hasFiles ? null : h("p", { class: "drop-title" }, `Drop ${kind} here`),
    hasFiles ? null : h("p", { class: "drop-or" }, "or"),
    h("button", { type: "button", class: "btn", "data-key": "pick", onclick: pick },
      hasFiles ? (tool.multiple ? `Add more ${tool.accepts === "image" ? "images" : "PDFs"}` : "Choose a different file") : `Choose ${kind}`),
  );
  return zone;
}

function fileRow(item: FileItem, index: number, sortable: boolean): HTMLElement {
  const meta =
    item.status === "loading" ? "Reading…"
    : item.status === "error" ? item.error ?? "Could not be read."
    : [formatBytes(item.size), item.pageCount ? `${item.pageCount} page${item.pageCount === 1 ? "" : "s"}` : null, item.wasEncrypted ? "unlocked" : null]
        .filter(Boolean)
        .join(" · ");
  const li = h(
    "li",
    {
      class: `file-row is-${item.status}`,
      draggable: sortable ? "true" : null,
      ondragstart: ((e: DragEvent) => {
        e.dataTransfer?.setData("application/x-pdf-tools-row", String(index));
        li.classList.add("is-dragging");
      }) as EventListener,
      ondragend: () => li.classList.remove("is-dragging"),
      ondragover: ((e: DragEvent) => {
        if (!e.dataTransfer?.types.includes("application/x-pdf-tools-row")) return;
        e.preventDefault();
      }) as EventListener,
      ondrop: ((e: DragEvent) => {
        const from = e.dataTransfer?.getData("application/x-pdf-tools-row");
        if (!from) return;
        e.preventDefault();
        moveFile(Number(from), index);
      }) as EventListener,
    },
    sortable ? h("span", { class: "grip", "aria-hidden": "true" }, "☰") : null,
    item.status === "loading" ? h("span", { class: "spinner", "aria-hidden": "true" }) : null,
    h("span", { class: "file-name" }, item.name),
    h("span", { class: "file-meta" }, meta),
    h("button", {
      type: "button",
      class: "icon-btn",
      "aria-label": `Remove ${item.name}`,
      title: "Remove",
      "data-key": `rm${index}`,
      onclick: () => removeFile(item.id),
    }, "✕"),
  );
  return li;
}

function radio(name: string, value: string, checked: boolean, label: string, onChange: () => void): HTMLElement {
  return h("label", { class: "choice" },
    h("input", { type: "radio", name, value, checked, "data-key": `${name}-${value}`, onchange: onChange }),
    h("span", {}, label));
}

function optionsFor(tool: ToolInfo, s: ToolState): HTMLElement | null {
  const o = s.options;
  const set = <K extends keyof Options>(k: K, v: Options[K], rerender = true) => {
    o[k] = v;
    s.result = undefined;
    if (rerender) render();
    else updateRunButton();
  };
  switch (tool.id) {
    case "split": {
      const ready = readyFiles(s)[0];
      const rangeError = h("p", { class: "field-error", id: "ranges-error" });
      const field = h("input", {
        type: "text",
        id: "ranges",
        class: "text-input",
        inputmode: "numeric",
        autocomplete: "off",
        spellcheck: "false",
        placeholder: "e.g. 1-3,5,8-",
        value: o.ranges,
        "aria-describedby": "ranges-help ranges-error",
        "data-key": "ranges",
        oninput: (e: Event) => {
          set("ranges", (e.target as HTMLInputElement).value, false);
          checkRanges();
        },
      });
      const checkRanges = () => {
        const problem = ready?.pageCount && o.ranges.trim() ? rangeProblem(o.ranges, ready.pageCount) : null;
        rangeError.textContent = problem ?? "";
        if (problem) field.setAttribute("aria-invalid", "true");
        else field.removeAttribute("aria-invalid");
      };
      checkRanges();
      return h("fieldset", { class: "options" },
        h("legend", {}, "How to split"),
        radio("split", "ranges", o.splitMode === "ranges", "Extract page ranges, one PDF per range", () => set("splitMode", "ranges")),
        radio("split", "every", o.splitMode === "every", "Every page as its own PDF", () => set("splitMode", "every")),
        o.splitMode === "ranges"
          ? h("div", { class: "field" },
              h("label", { for: "ranges" }, "Pages"),
              field,
              h("p", { class: "hint", id: "ranges-help" }, `Separate ranges with commas. "8-" means page 8 to the end.${ready?.pageCount ? ` This PDF has ${ready.pageCount} pages.` : ""}`),
              rangeError)
          : null);
    }
    case "topng":
      return h("fieldset", { class: "options" },
        h("legend", {}, "Image format"),
        radio("fmt", "png", o.imageFormat === "png", "PNG: sharp text, larger files", () => set("imageFormat", "png")),
        radio("fmt", "jpeg", o.imageFormat === "jpeg", "JPEG: smaller files, good for photos", () => set("imageFormat", "jpeg")),
        h("p", { class: "legend-like" }, "Resolution"),
        radio("dpi", "72", o.dpi === 72, "72 dpi (screen)", () => set("dpi", 72)),
        radio("dpi", "150", o.dpi === 150, "150 dpi", () => set("dpi", 150)),
        radio("dpi", "300", o.dpi === 300, "300 dpi (print)", () => set("dpi", 300)));
    case "compress":
      return h("fieldset", { class: "options" },
        h("legend", {}, "Compression"),
        radio("cmode", "lossless", o.compressMode === "lossless", "Lossless: rewrites the file more tightly. Text stays selectable.", () => set("compressMode", "lossless")),
        radio("cmode", "rasterise", o.compressMode === "rasterise", "Rasterise: turns each page into an image. Much smaller for scans.", () => set("compressMode", "rasterise")),
        o.compressMode === "rasterise"
          ? h("div", { class: "warning", role: "note" },
              h("strong", {}, "Before you run this: "),
              "rasterising replaces every page with a picture of it. Text will no longer be selectable or searchable, links and form fields will stop working, and the result can look softer.",
              h("div", { class: "sub-choices" },
                radio("preset", "balanced", o.rasterPreset === "balanced", RASTER_PRESETS.balanced.label, () => set("rasterPreset", "balanced")),
                radio("preset", "strong", o.rasterPreset === "strong", RASTER_PRESETS.strong.label, () => set("rasterPreset", "strong"))))
          : null);
    default:
      return null;
  }
}

function organiseGrid(s: ToolState): HTMLElement | null {
  const file = readyFiles(s)[0];
  if (!file) return null;
  if (s.gridFor !== file.id) {
    clearGrid(s);
    s.gridFor = file.id;
    const id = file.id;
    getRasterizer()
      .then((r) => r.preview(file.bytes!))
      .then(async (doc) => {
        if (s.gridFor !== id) return void doc.destroy();
        const { PageGrid } = await import("./ui/thumbnails.ts");
        s.grid = new PageGrid(doc, (pages) => {
          s.pages = pages;
          s.result = undefined;
          render();
        });
        s.pages = s.grid.pages;
        render();
      })
      .catch((e: unknown) => {
        s.error = `${file.name}: page previews failed (${e instanceof Error ? e.message : String(e)}).`;
        announceError(s.error);
        render();
      });
  }
  if (!s.grid) return h("p", { class: "loading-line" }, h("span", { class: "spinner", "aria-hidden": "true" }), "Drawing page thumbnails…");
  const kept = s.pages.length;
  return h("section", { class: "organise", "aria-label": "Pages" },
    h("div", { class: "organise-bar" },
      h("p", {}, `${kept} of ${file.pageCount} pages kept. Drag pages to reorder them.`),
      h("button", { type: "button", class: "btn ghost", "data-key": "reset", onclick: () => s.grid?.reset() }, "Reset")),
    s.grid.el);
}

let runButton: HTMLButtonElement | null = null;
let runHint: HTMLElement | null = null;
function updateRunButton(): void {
  if (!runButton || !runHint) return;
  const s = state();
  const reason = blockReason(info(), s);
  runButton.disabled = s.running || reason !== null;
  runHint.textContent = s.running ? "" : reason ?? "";
}

function resultView(s: ToolState): HTMLElement | null {
  const r = s.result;
  if (!r) return null;
  const saved = r.before > 0 ? Math.round((1 - r.after / r.before) * 100) : 0;
  const sizeLine =
    current === "compress"
      ? r.keptOriginal
        ? `${formatBytes(r.before)}. This mode could not make it smaller, so your file is unchanged.`
        : `${formatBytes(r.before)} → ${formatBytes(r.after)} (${saved}% smaller)`
      : `${formatBytes(r.before)} in → ${formatBytes(r.after)} out`;
  const many = r.files.length > 1;
  const zipAll = async () => {
    const { zipStore } = await import("./ui/zip.ts");
    downloadBytes(zipStore(r.files), r.zipName ?? "files.zip", "application/zip");
  };
  return h("section", { class: "result", "aria-label": "Result" },
    h("h2", {}, "Done"),
    h("p", { class: "sizes" }, sizeLine),
    many ? h("button", { type: "button", class: "btn primary", "data-key": "zip", onclick: () => void zipAll() }, `Download all ${r.files.length} (.zip)`) : null,
    h("ul", { class: "downloads" },
      ...r.files.map((f, i) =>
        h("li", {},
          h("span", { class: "file-name" }, f.name),
          h("span", { class: "file-meta" }, formatBytes(f.bytes.length)),
          h("button", {
            type: "button",
            class: many ? "btn" : "btn primary",
            "data-key": `dl${i}`,
            onclick: () => downloadBytes(f.bytes, f.name, mimeFor(f.name)),
          }, "Download")))));
}

function render(): void {
  const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.key;
  const tool = info();
  const s = state();
  const sortable = tool.multiple && s.files.length > 1 && !s.running;

  runButton = h("button", { type: "button", class: "btn primary run", "data-key": "run", onclick: () => void run() },
    s.running ? "Working…" : tool.id === "compress" && s.options.compressMode === "rasterise" ? "Rasterise and compress" : tool.runLabel);
  runHint = h("p", { class: "hint run-hint" });
  progressEl = s.running ? h("progress", { class: "progress", "aria-label": "Progress" }) : null;

  panel.setAttribute("aria-labelledby", `tab-${tool.id}`);
  const parts: (Node | null)[] = [
    h("p", { class: "blurb" }, tool.blurb),
    s.files.length
      ? h("div", { class: "files" },
          sortable ? h("p", { class: "hint" }, "Drag files to change their order.") : null,
          h("ol", { class: "file-list", "aria-label": "Files" }, ...s.files.map((f, i) => fileRow(f, i, sortable))))
      : null,
    dropZone(tool, s.files.length > 0),
    tool.id === "organise" ? organiseGrid(s) : null,
    s.files.some((f) => f.status === "ready") ? optionsFor(tool, s) : null,
    h("div", { class: "run-bar" }, runButton, progressEl, runHint),
    s.error ? h("p", { class: "error-box" }, s.error) : null,
    resultView(s),
  ];
  panel.replaceChildren(...parts.filter((n): n is Node => n !== null));
  updateRunButton();
  updateProgress();
  if (focusKey) panel.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusKey)}"]`)?.focus();
}

// Dropping a file anywhere outside the drop zone should not make the browser open it.
for (const type of ["dragover", "drop"]) {
  window.addEventListener(type, (e) => {
    const dt = (e as DragEvent).dataTransfer;
    if (dt?.types.includes("Files")) e.preventDefault();
  });
}

document.body.append(fileInput);
renderTabs();
render();
