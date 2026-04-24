import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts", "src/server.ts", "src/tail.ts", "src/analyze.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node18",
  splitting: false,
  treeshake: true,
  external: ["llmmeter-core", "llmmeter-sqlite", "llmmeter-postgres", "better-sqlite3", "pg"],
});
