#!/usr/bin/env node
import { spawn } from "node:child_process";

const request = {
  version: 1,
  root: ".",
  query: { type: "literal", text: "miku-grep" },
  // Exclude local npm pack cache logs so smoke output stays repository-focused.
  search: {
    targets: ["filepath", "content"],
    recursive: true,
    maxDepth: 3,
    excludeDirNamePatterns: [".git", ".svn", "node_modules", "target", "build", "dist", ".gradle", ".idea", ".vscode", ".settings", "vendor", ".npm-cache"],
  },
  output: { mode: "summary", maxMatches: 20 }
};

const child = spawn(process.execPath, ["dist/main.js"], { stdio: ["pipe", "inherit", "inherit"] });
child.stdin.end(`${JSON.stringify(request)}\n`);
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
