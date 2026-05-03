#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";

const versionResult = spawnSync(process.execPath, ["bundle/miku-grep.mjs", "--version"], {
  encoding: "utf8",
});

if (versionResult.status !== 0 || !versionResult.stdout.startsWith("miku-grep ")) {
  process.stderr.write(versionResult.stderr || versionResult.stdout || "bundle --version smoke failed\n");
  process.exit(1);
}

const helpResult = spawnSync(process.execPath, ["bundle/miku-grep.mjs", "--help"], {
  encoding: "utf8",
});
if (
  helpResult.status !== 0 ||
  !helpResult.stdout.includes("REQUEST FIELDS") ||
  !helpResult.stdout.includes("FULL STDIN / STDOUT EXAMPLE")
) {
  process.stderr.write(helpResult.stderr || helpResult.stdout || "bundle --help smoke failed\n");
  process.exit(1);
}

const request = {
  version: 1,
  root: ".",
  query: { type: "literal", text: "miku-grep" },
  search: { targets: ["filepath"], recursive: true, maxDepth: 2 },
  output: { mode: "summary", maxMatches: 10 },
};
const stdioResult = await runWithInput(process.execPath, ["bundle/miku-grep.mjs"], `${JSON.stringify(request)}\n`);

if (stdioResult.code !== 0) {
  process.stderr.write(stdioResult.stderr || stdioResult.stdout || "bundle stdio smoke failed\n");
  process.exit(1);
}

const parsed = JSON.parse(stdioResult.stdout);
if (parsed.version !== 1 || parsed.ok !== true || !Array.isArray(parsed.matches)) {
  process.stderr.write("bundle stdio smoke returned unexpected JSON\n");
  process.exit(1);
}

const archiveResult = spawnSync("tar", ["-tzf", "bundle/miku-grep-sources.tgz"], {
  encoding: "utf8",
});
if (archiveResult.status !== 0) {
  process.stderr.write(archiveResult.stderr || "source archive smoke failed\n");
  process.exit(1);
}
const archiveEntries = new Set(archiveResult.stdout.trim().split("\n"));
for (const entry of [
  "package.json",
  "src/main.ts",
  "src/types.ts",
  "src/public-types.ts",
  "src/internal-types.ts",
  "test/helpers.ts",
  "test/cli-meta.test.ts",
  "test/search-content.test.ts",
  "scripts/build-cli-bundle.mjs",
]) {
  if (!archiveEntries.has(entry)) {
    process.stderr.write(`source archive missing ${entry}\n`);
    process.exit(1);
  }
}

process.stdout.write(versionResult.stdout);

function runWithInput(command, args, input) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(input);
  });
}
