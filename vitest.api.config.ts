import { defineConfig } from "vite";

export default defineConfig({
  test: {
    environment: "node",
    include: ["apps/api/src/__tests__/**/*.integration.ts"],
    globals: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});