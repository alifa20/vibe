import { defineConfig } from "vitest/config";
import { cspMeta, selfHostVendorFiles } from "./vite.plugins.ts";

export default defineConfig({
  plugins: process.env.VITEST ? [] : [selfHostVendorFiles(), cspMeta()],
  worker: { format: "es" },
  // pdf-lib (the lazy "load" chunk) is ~570 kB minified; it is only fetched once a file is added.
  build: { chunkSizeWarningLimit: 700 },
  test: { environment: "node", include: ["test/**/*.test.ts"] },
});
