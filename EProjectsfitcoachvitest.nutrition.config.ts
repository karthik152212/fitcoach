import { defineConfig } from "vite";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["packages/nutrition/src/**/*.test.ts"],
  },
});
