import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CSP, cspMeta } from "../vite.plugins.ts";

describe("CSP meta plugin", () => {
  it("uses the policy the toolkit is designed for", () => {
    expect(CSP).toBe(
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; img-src 'self' blob: data:; " +
        "connect-src 'self' blob:; style-src 'self'; object-src 'none'; base-uri 'none'",
    );
    expect(CSP).not.toMatch(/unsafe-inline|'unsafe-eval'/);
  });

  it("runs only in the build and puts the meta first in <head>", () => {
    const plugin = cspMeta();
    expect(plugin.apply).toBe("build");
    const hook = plugin.transformIndexHtml as () => unknown;
    expect(hook()).toEqual([
      { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CSP }, injectTo: "head-prepend" },
    ]);
  });

  it("is not written into the index.html source", () => {
    const src = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    expect(src).not.toMatch(/Content-Security-Policy/i);
  });
});
