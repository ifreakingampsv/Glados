import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["tests/global-setup.ts"],
    hookTimeout: 120_000,
    testTimeout: 30_000,
    // All files share one real Postgres — parallel files would race on
    // cross-file cleanup (deleteMany). Sequential files, parallel tests.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
