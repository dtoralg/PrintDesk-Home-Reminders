import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  outDir: "dist",
  splitting: false,
  noExternal: [/@printdesk\/backend/, /@printdesk\/shared-models/],
});
