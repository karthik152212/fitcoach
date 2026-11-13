import { defineConfig } from "vite";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["packages/fitness-core/src/**/*.test.ts"],
  },
});