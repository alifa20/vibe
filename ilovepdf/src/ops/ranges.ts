/** A 1-based, inclusive page range. */
export interface PageRange {
  start: number;
  end: number;
}

/** A page-range spec the user typed could not be used. The message is shown as-is. */
export class RangeSyntaxError extends Error {
  override name = "RangeSyntaxError";
}

const PART = /^(\d+)\s*(?:(-)\s*(\d*))?$/;

/**
 * Parse a spec such as `1-3,5,8-` against a document of `pageCount` pages.
 * `8-` runs to the last page. Each comma-separated part becomes one range, in the order given.
 */
export function parseRanges(spec: string, pageCount: number): PageRange[] {
  const trimmed = spec.trim();
  if (!trimmed) throw new RangeSyntaxError("Enter at least one page or range, such as 1-3,5.");

  const tooFar = (n: number) =>
    new RangeSyntaxError(`There is no page ${n}: this PDF has only ${pageCount} pages.`);

  return trimmed.split(",").map((raw) => {
    const part = raw.trim();
    if (!part) throw new RangeSyntaxError("One of the ranges is empty. Check for a doubled or trailing comma.");
    const m = PART.exec(part);
    if (!m) throw new RangeSyntaxError(`"${part}" is not a page or range. Use forms like 4, 2-6 or 8-.`);

    const start = Number(m[1]);
    const end = m[2] ? (m[3] ? Number(m[3]) : pageCount) : start;
    if (start === 0 || end === 0) throw new RangeSyntaxError("There is no page 0: pages are numbered from 1.");
    if (start > pageCount) throw tooFar(start);
    if (end > pageCount) throw tooFar(end);
    if (end < start) throw new RangeSyntaxError(`"${part}" runs backwards. Write the lower page first.`);
    return { start, end };
  });
}
