// The organise view: a grid of page thumbnails that can be dragged to reorder, rotated and
// deleted. Thumbnails are drawn by pdf.js only when they scroll into view, one at a time.
import { normaliseAngle, type PageEdit } from "../ops/pages.ts";
import type { PreviewDoc } from "../render.ts";
import { h } from "./dom.ts";

const THUMB_CSS_WIDTH = 132;

const unchangedPages = (count: number): PageEdit[] => Array.from({ length: count }, (_, from) => ({ from, rotate: 0 }));

export class PageGrid {
  readonly el: HTMLOListElement;
  pages: PageEdit[];
  private readonly canvases = new Map<number, HTMLCanvasElement>();
  private readonly drawn = new Set<number>();
  private readonly observer: IntersectionObserver;
  private queue: Promise<void> = Promise.resolve();
  private dragFrom = -1;
  private destroyed = false;
  private readonly doc: PreviewDoc;
  private readonly onChange: (pages: PageEdit[]) => void;

  constructor(doc: PreviewDoc, onChange: (pages: PageEdit[]) => void) {
    this.doc = doc;
    this.onChange = onChange;
    this.pages = unchangedPages(doc.numPages);
    this.el = h("ol", { class: "page-grid", "aria-label": "Pages. Drag a page to move it." });
    this.observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        this.observer.unobserve(entry.target);
        this.draw(Number((entry.target as HTMLElement).dataset.from));
      }
    }, { rootMargin: "200px" });
    this.render();
  }

  reset(): void {
    this.pages = unchangedPages(this.doc.numPages);
    this.changed();
  }

  destroy(): void {
    this.destroyed = true;
    this.observer.disconnect();
    void this.doc.destroy();
  }

  private changed(): void {
    this.render();
    this.onChange(this.pages);
  }

  private canvasFor(from: number): HTMLCanvasElement {
    let c = this.canvases.get(from);
    if (!c) {
      c = h("canvas", { class: "thumb-canvas", width: 1, height: 1, "aria-hidden": "true" });
      c.dataset.from = String(from);
      this.canvases.set(from, c);
    }
    return c;
  }

  private draw(from: number): void {
    if (this.drawn.has(from)) return;
    this.drawn.add(from);
    const canvas = this.canvasFor(from);
    this.queue = this.queue.then(async () => {
      if (this.destroyed) return;
      try {
        await this.doc.drawThumbnail(from + 1, canvas, THUMB_CSS_WIDTH, Math.min(globalThis.devicePixelRatio || 1, 2));
        canvas.classList.add("is-drawn");
      } catch {
        canvas.parentElement?.classList.add("thumb-failed");
      }
    });
  }

  private turn(i: number, by: number): void {
    this.pages = this.pages.map((p, j) => (j === i ? { ...p, rotate: normaliseAngle(p.rotate + by) } : p));
    this.changed();
  }

  private remove(i: number): void {
    if (this.pages.length <= 1) return;
    this.pages = this.pages.filter((_, j) => j !== i);
    this.changed();
  }

  private move(from: number, to: number): void {
    if (from === to || from < 0) return;
    const next = [...this.pages];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    this.pages = next;
    this.changed();
  }

  render(): void {
    const last = this.pages.length <= 1;
    const items = this.pages.map((p, i) => {
      const canvas = this.canvasFor(p.from);
      const label = `Page ${p.from + 1}`;
      const li = h(
        "li",
        {
          class: "page-card",
          draggable: "true",
          "aria-label": `${label}, position ${i + 1} of ${this.pages.length}${p.rotate ? `, turned ${p.rotate} degrees` : ""}`,
          ondragstart: ((e: DragEvent) => {
            this.dragFrom = i;
            e.dataTransfer?.setData("text/plain", String(i));
            if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
            li.classList.add("is-dragging");
          }) as EventListener,
          ondragend: () => {
            this.dragFrom = -1;
            li.classList.remove("is-dragging");
          },
          // Only page drags started here are handled; anything else (a desktop file) falls through
          // to the file drop zone.
          ondragover: ((e: DragEvent) => {
            if (this.dragFrom < 0) return;
            e.preventDefault();
            li.classList.add("is-drop-target");
          }) as EventListener,
          ondragleave: () => li.classList.remove("is-drop-target"),
          ondrop: ((e: DragEvent) => {
            if (this.dragFrom < 0) return;
            e.preventDefault();
            e.stopPropagation();
            const from = this.dragFrom;
            this.dragFrom = -1;
            li.classList.remove("is-drop-target");
            this.move(from, i);
          }) as EventListener,
        },
        h("div", { class: `thumb-frame rot-${p.rotate}` }, canvas),
        h("span", { class: "page-label" }, label),
        h(
          "div",
          { class: "page-actions" },
          h("button", { type: "button", class: "icon-btn", "aria-label": `Turn ${label} left`, title: "Turn left", "data-key": `l${p.from}`, onclick: () => this.turn(i, -90) }, "↺"),
          h("button", { type: "button", class: "icon-btn", "aria-label": `Turn ${label} right`, title: "Turn right", "data-key": `r${p.from}`, onclick: () => this.turn(i, 90) }, "↻"),
          h("button", { type: "button", class: "icon-btn danger", "aria-label": `Delete ${label}`, title: last ? "A PDF needs at least one page" : "Delete page", disabled: last, "data-key": `d${p.from}`, onclick: () => this.remove(i) }, "✕"),
        ),
      );
      return li;
    });
    this.el.replaceChildren(...items);
    for (const p of this.pages) if (!this.drawn.has(p.from)) this.observer.observe(this.canvasFor(p.from));
  }
}
