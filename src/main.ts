#!/usr/bin/env node

import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { helpText } from "./help.js";
import { createSummary, finish } from "./result.js";
import { runSearch } from "./search.js";
import { validateAndNormalize } from "./validation.js";
import type {
  Diagnostic,
  MikuGrepResult,
} from "./public-types.js";

export { helpText } from "./help.js";
export { globMatch } from "./glob.js";

export type {
  DetailMatch,
  Diagnostic,
  EffectiveRequest,
  EncodingRuleInput,
  EncodingRuleResult,
  FileSummaryMatch,
  IgnoreLoadedSource,
  IgnoreMode,
  IgnoreSource,
  MikuGrepRequest,
  MikuGrepResult,
  OutputMode,
  QueryType,
  SearchTarget,
  Summary,
  SupportedEncoding,
} from "./types.js";

export async function main(argv = process.argv, stdin = process.stdin, stdout = process.stdout, stderr = process.stderr): Promise<number> {
  try {
    if (argv.length === 3 && argv[2] === "--version") {
      stdout.write(`miku-grep ${await packageVersion()}\n`);
      return 0;
    }
    if (argv.length === 3 && (argv[2] === "--help" || argv[2] === "-h")) {
      stdout.write(helpText());
      return 0;
    }
    if (argv.length === 3 && argv[2]?.startsWith("-")) {
      stderr.write("usage: miku-grep [--version|--help]\n");
      return 2;
    }
    if (argv.length > 2) {
      stderr.write("usage: miku-grep [--version|--help]\n");
      return 2;
    }

    let request: unknown;
    try {
      request = JSON.parse(await readStdin(stdin));
    } catch (error) {
      stderr.write(`malformed stdin: ${error instanceof Error ? error.message : String(error)}\n`);
      return 2;
    }

    const result = await runRequest(request);
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.ok ? 0 : 1;
  } catch (error) {
    stderr.write(`unexpected runtime error: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    return 3;
  }
}

export async function runRequest(request: unknown): Promise<MikuGrepResult> {
  const baseSummary = createSummary();
  const diagnostics: Diagnostic[] = [];
  const validation = validateAndNormalize(request);

  if (!validation.ok) {
    diagnostics.push({
      severity: "error",
      code: validation.code,
      message: validation.message,
      ...(validation.path ? { path: validation.path } : {}),
    });
    return finish(false, validation.code, validation.message, validation.effectiveRequest ?? {}, [], baseSummary, diagnostics);
  }

  const effectiveRequest = validation.effectiveRequest;
  const rootPath = path.resolve(process.cwd(), effectiveRequest.root);
  const rootCheck = await checkRoot(rootPath, effectiveRequest.root);
  if (!rootCheck.ok) {
    diagnostics.push(rootCheck.diagnostic);
    return finish(false, rootCheck.diagnostic.code, rootCheck.diagnostic.message, effectiveRequest, [], baseSummary, diagnostics);
  }

  const searchResult = await runSearch(effectiveRequest, rootCheck.realPath, diagnostics);
  return finish(true, null, null, effectiveRequest, searchResult.matches, searchResult.summary, diagnostics);
}

async function checkRoot(rootPath: string, requestRoot: string): Promise<{ ok: true; realPath: string } | { ok: false; diagnostic: Diagnostic }> {
  if (path.parse(rootPath).root === rootPath || rootPath === homeDirectory()) {
    return rootError("root_too_broad", "root is too broad", requestRoot);
  }
  try {
    const stat = await fs.stat(rootPath);
    if (!stat.isDirectory()) return rootError("root_not_accessible", "root is not a directory", requestRoot);
    await fs.access(rootPath, fsConstants.R_OK);
    const realPath = await fs.realpath(rootPath);
    return { ok: true, realPath };
  } catch (error) {
    const code = isNodeError(error) && error.code === "ENOENT" ? "root_not_found" : "root_not_accessible";
    return rootError(code, code === "root_not_found" ? "root does not exist" : "root is not accessible", requestRoot);
  }
}

function rootError(code: string, message: string, pathValue: string): { ok: false; diagnostic: Diagnostic } {
  return { ok: false, diagnostic: { severity: "error", code, message, path: pathValue } };
}

function homeDirectory(): string {
  return process.env.HOME ? path.resolve(process.env.HOME) : "";
}

async function readStdin(stdin: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString("utf8");
}

async function packageVersion(): Promise<string> {
  const bundledVersion = (globalThis as typeof globalThis & { __MIKU_GREP_BUNDLED_PACKAGE_VERSION__?: string }).__MIKU_GREP_BUNDLED_PACKAGE_VERSION__;
  if (bundledVersion) return bundledVersion;
  try {
    const pkg = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href &&
  !(globalThis as typeof globalThis & { __MIKU_GREP_BUNDLE_ENTRY__?: boolean }).__MIKU_GREP_BUNDLE_ENTRY__
) {
  process.exitCode = await main();
}
