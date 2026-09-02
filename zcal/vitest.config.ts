import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(process.cwd(), "src") },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    // Each test opens its own in-memory database, so nothing touches ./data.
    globals: false,
    reporters: ["default"],
  },
});
