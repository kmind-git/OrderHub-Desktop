import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // Produce a self-contained server.js so the release can be deployed with
  // only dist/migrations and no node_modules tree.
  noExternal: [/.*/],
  // esbuild strips the `node:` prefix for known builtins. `sqlite` is only
  // available as `node:sqlite` on supported Node LTS versions, so keep it
  // external and untouched.
  external: ["node:sqlite"],
});
