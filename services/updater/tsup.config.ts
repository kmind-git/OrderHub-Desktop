import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // @orderhub/contracts exports TypeScript source; bundle it so the deployed
  // server does not depend on the workspace package's source files.
  noExternal: ["@orderhub/contracts"],
  // esbuild strips the `node:` prefix for known builtins. `sqlite` is only
  // available as `node:sqlite` on supported Node LTS versions, so keep it
  // external and untouched.
  external: ["node:sqlite"],
});
