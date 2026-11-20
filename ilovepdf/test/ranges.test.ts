import { describe, expect, it } from "vitest";
import { RangeSyntaxError, parseRanges } from "../src/ops/ranges.ts";

describe("parseRanges", () => {
  it("reads single pages, closed ranges and open-ended ranges", () => {
    expect(parseRanges("1-3,5,8-", 10)).toEqual([
      { start: 1, end: 3 },
      { start: 5, end: 5 },
      { start: 8, end: 10 },
    ]);
  });

  it("ignores spaces around parts", () => {
    expect(parseRanges(" 2 - 4 , 6 ", 6)).toEqual([
      { start: 2, end: 4 },
      { start: 6, end: 6 },
    ]);
  });

  it("rejects page 0 and names it", () => {
    expect(() => parseRanges("0", 5)).toThrow(RangeSyntaxError);
    expect(() => parseRanges("0", 5)).toThrow(/page 0/i);
  });

  it("rejects a page past the end and says how many pages there are", () => {
    expect(() => parseRanges("6", 5)).toThrow(/page 6.*only 5 pages/i);
  });

  it("rejects an open range that starts past the end", () => {
    expect(() => parseRanges("7-", 5)).toThrow(/page 7.*only 5 pages/i);
  });

  it("rejects a reversed range and quotes it", () => {
    expect(() => parseRanges("3-1", 5)).toThrow(/"3-1".*backwards/i);
  });

  it("rejects text that is not a range and quotes it", () => {
    expect(() => parseRanges("abc", 5)).toThrow(/"abc"/);
  });

  it("rejects an empty spec and empty parts", () => {
    expect(() => parseRanges("", 5)).toThrow(/enter at least one/i);
    expect(() => parseRanges("1,,2", 5)).toThrow(/empty/i);
  });
});
