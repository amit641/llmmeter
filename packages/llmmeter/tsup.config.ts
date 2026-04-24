import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/openai.ts",
    "src/anthropic.ts",
    "src/sqlite.ts",
    "src/postgres.ts",
  ],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node18",
  splitting: false,
  treeshake: true,
  external: [
    "llmmeter-core",
    "llmmeter-openai",
    "llmmeter-anthropic",
    "llmmeter-sqlite",
    "llmmeter-postgres",
    "openai",
    "@anthropic-ai/sdk",
    "better-sqlite3",
    "pg",
  ],
});
