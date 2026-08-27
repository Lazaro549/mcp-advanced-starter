import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    conditions: ["import", "module", "default"],
    extensionAlias: {
      ".js": [".ts", ".js"],
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 10000,
    pool: "forks",
    poolOptions: {
      forks: {
        execArgv: ["--import", "tsx/esm"],
      },
    },
  },
});
