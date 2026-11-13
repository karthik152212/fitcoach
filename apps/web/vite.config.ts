import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * FitCoach web build. The dev server proxies /v0 to the local API so the
 * browser never deals with CORS; the API itself stays untouched.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/v0": {
        // The API defaults to 8787 (see apps/api/src/index.ts).
        target: process.env["FITCOACH_API_ORIGIN"] ?? "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["vitest.setup.ts"],
    css: false,
    globals: false,
    // Unit tests only: `e2e/` holds Playwright specs, which Vitest cannot run.
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
