#!/usr/bin/env node
import { spawn } from "node:child_process";

const request = {
  version: 1,
  root: ".",
  query: { type: "literal", text: "miku-grep" },
  // Exclude local npm pack cache logs so smoke output stays repository-focused.
  search: { target: "both", recursive: true, maxDepth: 3, excludeDirNamePatterns: [".npm-cache"] },
  output: { mode: "file-summary", maxMatches: 20 }
};

const child = spawn(process.execPath, ["dist/main.js"], { stdio: ["pipe", "inherit", "inherit"] });
child.stdin.end(`${JSON.stringify(request)}\n`);
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
