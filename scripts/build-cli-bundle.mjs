#!/usr/bin/env node
import fs from "node:fs/promises";
import { chmod } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";

const pkg = JSON.parse(await fs.readFile("package.json", "utf8"));

await fs.mkdir("bundle", { recursive: true });
await build({
  entryPoints: ["dist/bundle-entry.js"],
  outfile: "bundle/miku-grep.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);\nglobalThis.__MIKU_GREP_BUNDLE_ENTRY__ = true;"
  },
  define: {
    "globalThis.__MIKU_GREP_BUNDLED_PACKAGE_VERSION__": JSON.stringify(pkg.version)
  }
});
await chmod("bundle/miku-grep.mjs", 0o755);

const archiveResult = spawnSync(
  "tar",
  [
    "-czf",
    "bundle/miku-grep-sources.tgz",
    "package.json",
    "package-lock.json",
    "README.md",
    "LICENSE",
    "docs",
    "scripts",
    "src",
    "test",
    "tsconfig.json",
    "vitest.config.ts",
  ],
  { stdio: "inherit" },
);

if (archiveResult.status !== 0) {
  throw new Error("failed to create bundle/miku-grep-sources.tgz");
}
