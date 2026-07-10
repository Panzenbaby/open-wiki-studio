import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// Vitest runs the main-process modules in a plain node environment. The
// production code statically imports `electron` (for app.getLocale() in
// i18n) and `electron`-only APIs in files.ts; both are mocked in
// test/setup.ts so the ConceptStore — whose real dependency is the
// filesystem + the untyped label — is testable in isolation.
export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["test/setup.ts"],
    include: ["test/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "src/shared"),
    },
  },
});