#!/usr/bin/env node

import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { helpText } from "./help.js";
import { runListFiles } from "./list-files.js";
import { createSummary, finish } from "./result.js";
import { runSearch } from "./search.js";
import { validateAndNormalize } from "./validation.js";
import type {
  Diagnostic,
  MikuGrepRequest,
  MikuGrepResult,
  ReadfileRequestHint,
  SearchTarget,
  SupportedEncoding,
} from "./public-types.js";

export { helpText } from "./help.js";
export { globMatch } from "./glob.js";

export type {
  DetailMatch,
  Diagnostic,
  EffectiveRequest,
  EncodingRuleInput,
  EncodingRuleResult,
  FileListEntry,
  FileListSummary,
  FileSummaryMatch,
  IgnoreLoadedSource,
  IgnoreMode,
  IgnoreSource,
  MikuGrepRequest,
  MikuGrepResult,
  OutputMode,
  OutputSort,
  QueryCase,
  QueryType,
  ReadfileRequestHint,
  RelevanceInfo,
  RequestMode,
  SearchTarget,
  Summary,
  SupportedEncoding,
} from "./types.js";

export async function main(argv = process.argv, stdin = process.stdin, stdout = process.stdout, stderr = process.stderr): Promise<number> {
  try {
    const args = argv.slice(2);
    if (args.length === 1 && args[0] === "--version") {
      stdout.write(`miku-grep ${await packageVersion()}\n`);
      return 0;
    }
    if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
      stdout.write(helpText());
      return 0;
    }

    if (args.length > 0) {
      const parsed = parseArgs(args);
      if (!parsed.ok) {
        stderr.write(`${parsed.message}\nusage: miku-grep QUERY [ROOT] [--agent|--files|--context N|--format json]\n`);
        return 2;
      }
      const result = await runRequest(parsed.request);
      if (parsed.format === "json") {
        stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else if (result.ok) {
        stdout.write(formatTextResult(result, parsed.textMode));
      } else {
        stderr.write(formatTextError(result));
      }
      return result.ok ? 0 : 1;
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

type CliTextMode = "summary" | "agent" | "files";

type ParsedArgs =
  | { ok: true; request: MikuGrepRequest; format: "text" | "json"; textMode: CliTextMode }
  | { ok: false; message: string };

function parseArgs(args: string[]): ParsedArgs {
  const positionals: string[] = [];
  const request: MikuGrepRequest = {
    version: 1,
    root: ".",
    query: { type: "literal", text: "" },
    search: { targets: ["content"] },
    output: { mode: "summary" },
  };
  let format: "text" | "json" = "text";
  let textMode: CliTextMode = "summary";
  let filesMode = false;
  let filesOptionIndex = -1;
  let firstPositionalIndex = -1;
  let agentMode = false;
  let contextMode = false;
  let topFilesMode = false;
  let regexMode = false;
  let globMode = false;
  let pathMode = false;
  let allTargetsMode = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--format") {
      const value = args[++i];
      if (value !== "text" && value !== "json") return { ok: false, message: "--format must be text or json" };
      format = value;
    } else if (arg === "--json") {
      format = "json";
    } else if (arg === "--agent") {
      request.output = { ...request.output, mode: "agent", sort: "relevance", includeReadfileRequestHints: true };
      textMode = "agent";
      agentMode = true;
    } else if (arg === "--files") {
      filesMode = true;
      filesOptionIndex = i;
      textMode = "files";
    } else if (arg === "--context") {
      const value = parseNonNegativeInteger(args[++i], "--context");
      if (!value.ok) return value;
      request.output = { ...request.output, mode: "detail", contextLines: value.value };
      contextMode = true;
    } else if (arg === "--limit") {
      const value = parsePositiveInteger(args[++i], "--limit");
      if (!value.ok) return value;
      request.output = { ...request.output, maxMatches: value.value };
    } else if (arg === "--top-files") {
      const value = parsePositiveInteger(args[++i], "--top-files");
      if (!value.ok) return value;
      request.output = { ...request.output, maxMatches: value.value, mode: "agent", sort: "relevance" };
      textMode = "agent";
      topFilesMode = true;
    } else if (arg === "--encoding") {
      const value = args[++i];
      if (value !== "utf-8" && value !== "shift_jis") return { ok: false, message: "--encoding must be utf-8 or shift_jis" };
      request.encoding = { ...request.encoding, default: value as SupportedEncoding };
    } else if (arg === "--encoding-preset") {
      const value = args[++i];
      if (value !== "japanese-legacy") return { ok: false, message: "--encoding-preset must be japanese-legacy" };
      request.encoding = { ...request.encoding, preset: value };
    } else if (arg === "--ignore-case" || arg === "-i") {
      request.query = { type: "literal", text: "", ...request.query, case: "insensitive" };
    } else if (arg === "--regex") {
      const currentQuery = request.query ?? { type: "literal", text: "" };
      request.query = { ...currentQuery, type: "regex" };
      regexMode = true;
    } else if (arg === "--glob") {
      const currentQuery = request.query ?? { type: "literal", text: "" };
      request.query = { ...currentQuery, type: "glob" };
      request.search = { ...request.search, targets: ["filepath"] };
      globMode = true;
    } else if (arg === "--path") {
      request.search = { ...request.search, targets: ["filepath"] };
      pathMode = true;
    } else if (arg === "--all-targets") {
      request.search = { ...request.search, targets: ["filepath", "directory", "content"] };
      allTargetsMode = true;
    } else if (arg === "--detect-git-root") {
      request.detectGitRoot = true;
    } else if (arg === "--no-ignore") {
      request.ignore = { mode: "none" };
    } else if (arg.startsWith("-")) {
      return { ok: false, message: `unknown option: ${arg}` };
    } else {
      if (firstPositionalIndex < 0) firstPositionalIndex = i;
      positionals.push(arg);
    }
  }

  const modeConflict = [filesMode, agentMode || topFilesMode, contextMode].filter(Boolean).length > 1;
  if (modeConflict) return { ok: false, message: "--files, --agent/--top-files, and --context are mutually exclusive" };
  if (regexMode && globMode) return { ok: false, message: "--regex and --glob are mutually exclusive" };
  if (pathMode && allTargetsMode) return { ok: false, message: "--path and --all-targets are mutually exclusive" };
  if (globMode && allTargetsMode) return { ok: false, message: "--glob and --all-targets are mutually exclusive" };

  const filesInventoryMode = filesMode && (positionals.length === 0 || (positionals.length === 1 && filesOptionIndex >= 0 && filesOptionIndex < firstPositionalIndex));
  if (filesInventoryMode) {
    delete request.query;
    request.mode = "listFiles";
    request.root = positionals[0] ?? ".";
    return { ok: true, request, format, textMode };
  }

  if (positionals.length < 1 || positionals.length > 2) {
    return { ok: false, message: "expected QUERY [ROOT]" };
  }

  request.query = { type: "literal", case: "sensitive", ...request.query, text: positionals[0] };
  request.root = positionals[1] ?? ".";
  if (filesMode) {
    request.output = { ...request.output, mode: "summary" };
    request.search = { ...request.search, targets: ensureFileTargets(request.search?.targets) };
  }
  return { ok: true, request, format, textMode };
}

function parsePositiveInteger(value: string | undefined, option: string): { ok: true; value: number } | { ok: false; message: string } {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return { ok: false, message: `${option} requires a positive integer` };
  return { ok: true, value: parsed };
}

function parseNonNegativeInteger(value: string | undefined, option: string): { ok: true; value: number } | { ok: false; message: string } {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return { ok: false, message: `${option} requires a non-negative integer` };
  return { ok: true, value: parsed };
}

function ensureFileTargets(targets: SearchTarget[] | undefined): SearchTarget[] {
  if (!targets || targets.length === 0) return ["content"];
  return targets.filter((target) => target !== "directory");
}

function formatTextResult(result: MikuGrepResult, mode: CliTextMode): string {
  if (mode === "files") return formatFilesText(result);
  if (mode === "agent") return formatAgentText(result);
  if (result.effectiveRequest.mode === "listFiles") return formatFilesText(result);
  return formatSummaryText(result);
}

function formatFilesText(result: MikuGrepResult): string {
  const files = result.files && result.files.length > 0 ? result.files.map((file) => file.path) : uniqueFiles(result);
  return files.length > 0 ? `${files.join("\n")}\n` : "";
}

function formatSummaryText(result: MikuGrepResult): string {
  const lines = [
    `matches: ${result.summary.matches}`,
    `files: ${result.summary.filesMatched}`,
  ];
  if (result.summary.directoriesMatched > 0) lines.push(`directories: ${result.summary.directoriesMatched}`);
  if (result.summary.truncated) lines.push(`truncated: ${result.summary.truncatedReason ?? "true"}`);
  if (result.diagnostics.length > 0) lines.push(`diagnostics: ${result.diagnostics.length}`);
  lines.push("");

  for (const match of result.matches.slice(0, 20)) {
    if (match.type === "file") {
      lines.push(`${match.file}  ${match.matchCount} match${match.matchCount === 1 ? "" : "es"}`);
      for (const snippet of match.snippets.slice(0, 3)) lines.push(`  ${snippet.line}: ${snippet.text}`);
    } else if (match.type === "content") {
      lines.push(`${match.file}:${match.line}:${match.column}: ${match.text}`);
      for (const context of match.contextBefore ?? []) lines.push(`  ${context.line}- ${context.text}`);
      for (const context of match.contextAfter ?? []) lines.push(`  ${context.line}+ ${context.text}`);
    } else if (match.type === "filepath") {
      lines.push(match.file);
    } else if (match.type === "directory") {
      lines.push(`${match.path}/`);
    } else if (match.type === "agentFile") {
      lines.push(`${match.file}  ${match.matchCount} match${match.matchCount === 1 ? "" : "es"}`);
    } else if (match.type === "agentDirectory") {
      lines.push(`${match.path}/  ${match.matchCount} match${match.matchCount === 1 ? "" : "es"}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function formatAgentText(result: MikuGrepResult): string {
  const lines = [
    `matches: ${result.summary.matches}`,
    `files: ${result.summary.filesMatched}`,
  ];
  if (result.summary.truncated) lines.push(`truncated: ${result.summary.truncatedReason ?? "true"}`);
  lines.push("", "top files:");

  const agentFiles = result.matches.filter((match) => match.type === "agentFile");
  for (const match of agentFiles.slice(0, 10)) {
    if (match.type !== "agentFile") continue;
    lines.push(`  ${match.file}  ${match.matchCount} match${match.matchCount === 1 ? "" : "es"}`);
    for (const snippet of match.representativeSnippets.slice(0, 2)) lines.push(`    ${snippet.line}: ${snippet.text}`);
  }

  const readRanges = agentFiles
    .flatMap((match) => (match.type === "agentFile" ? match.readRanges.slice(0, 1).map((range) => `${match.file}:${range.startLine}-${range.endLine}`) : []))
    .slice(0, 10);
  if (readRanges.length > 0) {
    lines.push("", "next reads:");
    for (const range of readRanges) lines.push(`  ${range}`);
  }
  return `${lines.join("\n")}\n`;
}

function formatTextError(result: MikuGrepResult): string {
  const error = result.error;
  const lines = [`error: ${error?.code ?? "unknown"}${error?.message ? `: ${error.message}` : ""}`];
  for (const diagnostic of result.diagnostics.slice(0, 5)) lines.push(`${diagnostic.severity}: ${diagnostic.code}: ${diagnostic.message}`);
  return `${lines.join("\n")}\n`;
}

function uniqueFiles(result: MikuGrepResult): string[] {
  const files = new Set<string>();
  for (const match of result.matches) {
    if (match.type === "file" || match.type === "filepath" || match.type === "content" || match.type === "agentFile") files.add(match.file);
  }
  return [...files].sort();
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
  const requestedRootPath = path.resolve(process.cwd(), effectiveRequest.root);
  const rootPath = effectiveRequest.detectGitRoot ? await detectGitRootPath(requestedRootPath) : requestedRootPath;
  if (effectiveRequest.detectGitRoot) effectiveRequest.root = displayRoot(rootPath);
  const rootCheck = await checkRoot(rootPath, effectiveRequest.root);
  if (!rootCheck.ok) {
    diagnostics.push(rootCheck.diagnostic);
    return finish(false, rootCheck.diagnostic.code, rootCheck.diagnostic.message, effectiveRequest, [], baseSummary, diagnostics);
  }

  if (effectiveRequest.mode === "listFiles") {
    const listResult = await runListFiles(effectiveRequest, rootCheck.realPath, diagnostics);
    return finish(true, null, null, effectiveRequest, [], listResult.summary, diagnostics, { files: listResult.files, fileSummary: listResult.fileSummary });
  }

  const searchResult = await runSearch(effectiveRequest, rootCheck.realPath, diagnostics);
  const readfileHints = effectiveRequest.output.includeReadfileRequestHints ? buildReadfileHints(effectiveRequest.root, searchResult.matches) : undefined;
  return finish(true, null, null, effectiveRequest, searchResult.matches, searchResult.summary, diagnostics, { readfileHints });
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

async function detectGitRootPath(startPath: string): Promise<string> {
  let current = startPath;
  try {
    const stat = await fs.stat(current);
    if (!stat.isDirectory()) current = path.dirname(current);
  } catch {
    return startPath;
  }
  while (true) {
    try {
      const gitStat = await fs.stat(path.join(current, ".git"));
      if (gitStat.isDirectory() || gitStat.isFile()) return current;
    } catch {
      // Continue upward until filesystem root.
    }
    const parent = path.dirname(current);
    if (parent === current) return startPath;
    current = parent;
  }
}

function displayRoot(rootPath: string): string {
  const relative = path.relative(process.cwd(), rootPath) || ".";
  return relative.split(path.sep).join("/");
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

function buildReadfileHints(root: string, matches: MikuGrepResult["matches"]): ReadfileRequestHint[] {
  const files = new Set<string>();
  for (const match of matches) {
    if (match.type === "content" || match.type === "filepath" || match.type === "file" || match.type === "agentFile") {
      files.add(match.file);
    }
  }
  return [...files].sort().map((file) => ({
    file,
    request: {
      version: 1,
      root,
      files: [{ path: file }],
    },
  }));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href &&
  !(globalThis as typeof globalThis & { __MIKU_GREP_BUNDLE_ENTRY__?: boolean }).__MIKU_GREP_BUNDLE_ENTRY__
) {
  process.exitCode = await main();
}
