import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Root Vitest config so a single web test file can be run from the repository
 * root (`npx vitest run apps/web/src/__tests__/onboarding.test.tsx`) without
 * giving up jsdom or the jest-dom setup.
 *
 * The web workspace keeps its own `apps/web/vite.config.ts` test section; both
 * describe the same environment, so `npm run test:web` is unaffected.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./apps/web/vitest.setup.ts"],
    css: false,
    globals: false,
    include: ["apps/web/src/**/*.test.{ts,tsx}"],
  },
});
