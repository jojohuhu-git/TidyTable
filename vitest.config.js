import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Tests default to the node environment (logic tests). Component tests opt in
// with a `// @vitest-environment happy-dom` comment at the top of the file, or
// by living under a *.dom.test.jsx name.
export default defineConfig({
  plugins: [react()],
  test: {
    // Enables @testing-library/react's automatic DOM cleanup between tests.
    globals: true,
    environment: "node",
    environmentMatchGlobs: [
      ["**/*.dom.test.{js,jsx}", "happy-dom"],
    ],
    setupFiles: ["./test/setup.js"],
    include: ["src/**/*.test.{js,jsx}", "test/**/*.test.{js,jsx}"],
  },
});
