import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/pricing.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node18",
  splitting: false,
  treeshake: true,
});
