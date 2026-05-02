#!/usr/bin/env node

import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import iconv from "iconv-lite";
import type {
  DetailMatch,
  Diagnostic,
  EffectiveRequest,
  EncodingRuleInput,
  EncodingRuleResult,
  FileSummaryMatch,
  MikuGrepResult,
  QueryType,
  SupportedEncoding,
  Summary,
} from "./types.js";

export type {
  DetailMatch,
  Diagnostic,
  EffectiveRequest,
  EncodingRuleInput,
  EncodingRuleResult,
  FileSummaryMatch,
  MikuGrepRequest,
  MikuGrepResult,
  OutputMode,
  QueryType,
  SearchTarget,
  Summary,
  SupportedEncoding,
} from "./types.js";

const VERSION = 1;
const DEFAULT_EXCLUDE_DIRS = [
  ".git",
  ".svn",
  "node_modules",
  "target",
  "build",
  "dist",
  ".gradle",
  ".idea",
  ".vscode",
  ".settings",
  "vendor",
];
const DEFAULT_EXCLUDE_FILES = [
  "*.class",
  "*.jar",
  "*.zip",
  "*.png",
  "*.jpg",
  "*.jpeg",
  "*.gif",
  "*.pdf",
  ".classpath",
  ".project",
];
const LIMITS = {
  maxDepth: 50,
  maxFileBytes: 104857600,
  maxMatches: 10000,
  maxMatchesPerFile: 1000,
  maxLineLength: 4000,
  maxSnippetsPerFile: 100,
};
const DEFAULTS = {
  search: {
    target: "content",
    recursive: true,
    maxDepth: 20,
    maxFileBytes: 10485760,
    includeFileNamePatterns: [] as string[],
    excludeFileNamePatterns: [] as string[],
    excludeDirNamePatterns: [] as string[],
  },
  output: {
    mode: "file-summary",
    maxMatches: 200,
    maxMatchesPerFile: 20,
    maxLineLength: 240,
    maxSnippetsPerFile: 3,
  },
  encoding: {
    default: "utf-8",
    rules: [],
    onDecodeError: "skip",
  },
} as const;

type ValidationResult =
  | { ok: true; effectiveRequest: EffectiveRequest }
  | { ok: false; code: string; message: string; path?: string; effectiveRequest?: EffectiveRequest | Record<string, never> };

type SearchState = {
  request: EffectiveRequest;
  rootPath: string;
  detailsByFile: Map<string, DetailMatch[]>;
  summariesByFile: Map<string, FileSummaryMatch>;
  diagnostics: Diagnostic[];
  truncationDiagnosticKeys: Set<string>;
  summary: Summary;
  globalLimitReached: boolean;
};

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

export function helpText(): string {
  return `miku-grep - local-first structured grep CLI for AI agents and automation

USAGE
  miku-grep < request.json > result.json
  miku-grep --version
  miku-grep --help

CONTRACT
  Primary input is stdin JSON. Primary output is stdout JSON.
  stdout is reserved for result JSON except --version and --help.
  stderr is for usage errors, malformed stdin, progress, verbose logs, and unexpected runtime messages.
  Request JSON and result JSON use top-level "version": 1.
  Unknown request fields are validation errors.
  Result JSON is pretty-printed with 2-space indentation and a trailing newline.

EXIT CODES
  0  ok: true, or explicit meta command such as --version / --help
  1  ok: false expected failure with stdout result JSON when possible
  2  malformed stdin or CLI usage error
  3  unexpected runtime error

MINIMAL REQUEST
  {
    "version": 1,
    "root": ".",
    "query": { "type": "literal", "text": "RepositoryMap" },
    "search": { "target": "content", "recursive": true, "maxDepth": 8 }
  }

REQUEST FIELDS
  root
    Search entry directory. Relative paths are resolved from current working directory.
    Result file paths are root-relative and always use "/".

  query.type
    "literal" or "regex".
    literal is case-sensitive substring search.
    regex uses Node.js RegExp, line by line for content search. Regex flags are not accepted.

  query.text
    Non-empty search text or regex pattern.

  search.target
    "content" searches file contents.
    "filename" searches root-relative file paths.
    "both" searches filename first, then content.
    Default: "content".

  search.recursive
    boolean. Default: true.

  search.maxDepth
    Default: 20 when recursive is true. Maximum: 50.

  search.maxFileBytes
    Content-read size limit. Default: 10485760. Maximum: 104857600.

  search.includeFileNamePatterns
    Optional glob array. Empty or missing means no include restriction.
    MVP glob supports "*" and "?" within one basename.

  search.excludeFileNamePatterns
    Optional additional basename glob excludes.
    Default excludes are always applied.

  search.excludeDirNamePatterns
    Optional additional directory basename glob excludes.
    Default excludes are always applied.

  output.mode
    "file-summary" or "detail". Default: "file-summary".

  output.maxMatches
    Default: 200. Maximum: 10000.

  output.maxMatchesPerFile
    Default: 20. Maximum: 1000.

  output.maxLineLength
    Returned snippet limit. Default: 240. Maximum: 4000.
    Snippets contain only source text. Artificial "..." is not added.

  output.maxSnippetsPerFile
    file-summary representative snippet limit. Default: 3. Maximum: 100.

  encoding.default
    "utf-8" or "shift_jis". Default: "utf-8".

  encoding.rules
    Array of { "pathPattern": "...", "encoding": "..." } or
    { "fileNamePattern": "...", "encoding": "..." }.
    pathPattern rules take priority over fileNamePattern rules.

  encoding.onDecodeError
    "skip". Decode failures are reported in diagnostics.

DEFAULT EXCLUDES
  Directory names:
    .git, .svn, node_modules, target, build, dist, .gradle, .idea, .vscode, .settings, vendor
  File name patterns:
    *.class, *.jar, *.zip, *.png, *.jpg, *.jpeg, *.gif, *.pdf, .classpath, .project

RESULT SHAPE
  {
    "version": 1,
    "ok": true,
    "error": null,
    "effectiveRequest": {},
    "matches": [],
    "summary": {
      "filesVisited": 0,
      "filesScanned": 0,
      "filesMatched": 0,
      "matches": 0,
      "diagnostics": 0,
      "truncated": false,
      "truncatedReason": null
    },
    "diagnostics": []
  }

FULL STDIN / STDOUT EXAMPLE
  Input:
    {
      "version": 1,
      "root": ".",
      "query": { "type": "literal", "text": "RepositoryMap" },
      "search": {
        "target": "content",
        "recursive": true,
        "maxDepth": 8,
        "includeFileNamePatterns": ["*.java", "*.md"]
      },
      "output": { "mode": "file-summary", "maxMatches": 20 }
    }

  Possible successful output:
    {
      "version": 1,
      "ok": true,
      "error": null,
      "effectiveRequest": {
        "root": ".",
        "query": { "type": "literal", "text": "RepositoryMap" },
        "search": {
          "target": "content",
          "recursive": true,
          "maxDepth": 8,
          "maxFileBytes": 10485760,
          "includeFileNamePatterns": ["*.java", "*.md"],
          "excludeFileNamePatterns": ["*.class", "*.jar", "*.zip", "*.png", "*.jpg", "*.jpeg", "*.gif", "*.pdf", ".classpath", ".project"],
          "excludeDirNamePatterns": [".git", ".svn", "node_modules", "target", "build", "dist", ".gradle", ".idea", ".vscode", ".settings", "vendor"]
        },
        "output": { "mode": "file-summary", "maxMatches": 20, "maxMatchesPerFile": 20, "maxLineLength": 240, "maxSnippetsPerFile": 3 },
        "encoding": { "default": "utf-8", "rules": [], "onDecodeError": "skip" }
      },
      "matches": [
        {
          "type": "file",
          "file": "src/RepositoryMap.java",
          "matchTypes": ["content"],
          "filenameMatched": false,
          "contentMatched": true,
          "lines": [42],
          "matchCount": 1,
          "snippets": [
            { "type": "content", "line": 42, "text": "class RepositoryMap {", "trimmed": false }
          ],
          "encoding": "utf-8",
          "encodingRule": { "type": "default" }
        }
      ],
      "summary": { "filesVisited": 12, "filesScanned": 10, "filesMatched": 1, "matches": 1, "diagnostics": 0, "truncated": false, "truncatedReason": null },
      "diagnostics": []
    }

  Possible validation error output:
    {
      "version": 1,
      "ok": false,
      "error": { "code": "empty_query", "message": "query.text must not be empty" },
      "effectiveRequest": {},
      "matches": [],
      "summary": { "filesVisited": 0, "filesScanned": 0, "filesMatched": 0, "matches": 0, "diagnostics": 1, "truncated": false, "truncatedReason": null },
      "diagnostics": [
        { "severity": "error", "code": "empty_query", "message": "query.text must not be empty" }
      ]
    }

DETAIL MATCHES
  Content hit:
    { "type": "content", "file": "src/App.java", "line": 42, "column": 7,
      "matchedText": "RepositoryMap", "text": "class RepositoryMap {",
      "trimmed": false, "encoding": "utf-8", "encodingRule": { "type": "default" } }
  Filename hit:
    { "type": "filename", "file": "src/RepositoryMap.java",
      "matchedText": "src/RepositoryMap.java" }

FILE-SUMMARY MATCHES
  { "type": "file", "file": "src/RepositoryMap.java",
    "matchTypes": ["filename", "content"],
    "filenameMatched": true, "contentMatched": true,
    "lines": [42], "matchCount": 1, "snippets": [] }

COMMON DIAGNOSTIC CODES
  Validation / expected failures:
    invalid_request, unknown_field, invalid_version, invalid_query_type,
    invalid_search_target, invalid_output_mode, invalid_regex,
    root_not_found, root_not_accessible, root_too_broad, empty_query,
    max_matches_too_large, max_matches_per_file_too_large, max_depth_too_large,
    max_line_length_too_large, max_snippets_per_file_too_large,
    max_file_bytes_too_large, invalid_encoding, invalid_encoding_rule
  Runtime diagnostics:
    directory_not_readable, symlink_skipped, file_not_readable,
    max_file_bytes_exceeded, binary_file_skipped, decode_error,
    max_matches, max_matches_per_file, max_snippets_per_file

EXAMPLES
  Content search:
    printf '%s\\n' '{"version":1,"root":".","query":{"type":"literal","text":"TODO"},"search":{"target":"content"}}' | miku-grep

  Filename search:
    printf '%s\\n' '{"version":1,"root":".","query":{"type":"regex","text":"Repository.*\\\\.java$"},"search":{"target":"filename"},"output":{"mode":"detail"}}' | miku-grep

SEE ALSO
  docs/miku-grep-cli-spec.md
`;
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

  const searchState: SearchState = {
    request: effectiveRequest,
    rootPath,
    detailsByFile: new Map(),
    summariesByFile: new Map(),
    diagnostics,
    truncationDiagnosticKeys: new Set(),
    summary: createSummary(),
    globalLimitReached: false,
  };

  await traverse(searchState, rootPath, "", 0);
  const matches = effectiveRequest.output.mode === "detail" ? buildDetailMatches(searchState) : buildFileSummaryMatches(searchState);
  searchState.summary.filesMatched = searchState.summariesByFile.size;
  searchState.summary.diagnostics = diagnostics.length;
  return finish(true, null, null, effectiveRequest, matches, searchState.summary, diagnostics);
}

function createSummary(): Summary {
  return {
    filesVisited: 0,
    filesScanned: 0,
    filesMatched: 0,
    matches: 0,
    diagnostics: 0,
    truncated: false,
    truncatedReason: null,
  };
}

function finish(
  ok: boolean,
  code: string | null,
  message: string | null,
  effectiveRequest: EffectiveRequest | Record<string, never>,
  matches: Array<DetailMatch | FileSummaryMatch>,
  summary: Summary,
  diagnostics: Diagnostic[],
): MikuGrepResult {
  return {
    version: VERSION,
    ok,
    error: ok ? null : { code: code ?? "invalid_request", message: message ?? "request failed" },
    effectiveRequest,
    matches,
    summary: { ...summary, diagnostics: diagnostics.length },
    diagnostics: sortDiagnostics(diagnostics),
  };
}

export function validateAndNormalize(request: unknown): ValidationResult {
  if (!isPlainObject(request)) return invalid("invalid_request", "request must be an object");
  const unknown = findUnknownField(request, {
    version: true,
    root: true,
    query: { type: true, text: true },
    search: {
      target: true,
      recursive: true,
      maxDepth: true,
      maxFileBytes: true,
      includeFileNamePatterns: true,
      excludeFileNamePatterns: true,
      excludeDirNamePatterns: true,
    },
    output: { mode: true, maxMatches: true, maxMatchesPerFile: true, maxLineLength: true, maxSnippetsPerFile: true },
    encoding: { default: true, rules: true, onDecodeError: true },
  });
  if (unknown) return invalid("unknown_field", `unknown field: ${unknown}`);
  if (request.version !== VERSION) return invalid("invalid_version", "version must be 1");
  if (typeof request.root !== "string" || request.root.length === 0) return invalid("invalid_request", "root must be a non-empty string");
  if (!isPlainObject(request.query)) return invalid("invalid_request", "query must be an object");
  if (!["literal", "regex"].includes(String(request.query.type))) return invalid("invalid_query_type", "query.type must be literal or regex");
  if (typeof request.query.text !== "string") return invalid("invalid_request", "query.text must be a string");
  if (request.query.text.length === 0) return invalid("empty_query", "query.text must not be empty");
  if (request.query.type === "regex") {
    try {
      new RegExp(request.query.text);
    } catch {
      return invalid("invalid_regex", "query.text is not a valid regular expression");
    }
  }

  const searchInput = request.search ?? {};
  const outputInput = request.output ?? {};
  const encodingInput = request.encoding ?? {};
  if (!isPlainObject(searchInput) || !isPlainObject(outputInput) || !isPlainObject(encodingInput)) {
    return invalid("invalid_request", "search, output, and encoding must be objects when specified");
  }

  const search = {
    target: typeof searchInput.target === "string" ? searchInput.target : DEFAULTS.search.target,
    recursive: searchInput.recursive ?? DEFAULTS.search.recursive,
    maxDepth: searchInput.maxDepth ?? DEFAULTS.search.maxDepth,
    maxFileBytes: searchInput.maxFileBytes ?? DEFAULTS.search.maxFileBytes,
    includeFileNamePatterns: searchInput.includeFileNamePatterns ?? [],
    excludeFileNamePatterns: searchInput.excludeFileNamePatterns ?? [],
    excludeDirNamePatterns: searchInput.excludeDirNamePatterns ?? [],
  };
  if (!["content", "filename", "both"].includes(search.target)) return invalid("invalid_search_target", "search.target must be content, filename, or both");
  if (typeof search.recursive !== "boolean") return invalid("invalid_request", "search.recursive must be boolean");
  if (!isSafeInteger(search.maxDepth) || search.maxDepth < 0) return invalid("invalid_request", "search.maxDepth must be a non-negative integer");
  if (search.maxDepth > LIMITS.maxDepth) return invalid("max_depth_too_large", "search.maxDepth is too large");
  if (!isSafeInteger(search.maxFileBytes) || search.maxFileBytes < 0) return invalid("invalid_request", "search.maxFileBytes must be a non-negative integer");
  if (search.maxFileBytes > LIMITS.maxFileBytes) return invalid("max_file_bytes_too_large", "search.maxFileBytes is too large");
  for (const field of ["includeFileNamePatterns", "excludeFileNamePatterns", "excludeDirNamePatterns"] as const) {
    if (!isStringArray(search[field])) return invalid("invalid_request", `search.${field} must be an array of strings`);
  }

  const output = {
    mode: typeof outputInput.mode === "string" ? outputInput.mode : DEFAULTS.output.mode,
    maxMatches: outputInput.maxMatches ?? DEFAULTS.output.maxMatches,
    maxMatchesPerFile: outputInput.maxMatchesPerFile ?? DEFAULTS.output.maxMatchesPerFile,
    maxLineLength: outputInput.maxLineLength ?? DEFAULTS.output.maxLineLength,
    maxSnippetsPerFile: outputInput.maxSnippetsPerFile ?? DEFAULTS.output.maxSnippetsPerFile,
  };
  if (!["detail", "file-summary"].includes(output.mode)) return invalid("invalid_output_mode", "output.mode must be detail or file-summary");
  for (const [field, code] of [
    ["maxMatches", "max_matches_too_large"],
    ["maxMatchesPerFile", "max_matches_per_file_too_large"],
    ["maxLineLength", "max_line_length_too_large"],
    ["maxSnippetsPerFile", "max_snippets_per_file_too_large"],
  ] as const) {
    if (!isSafeInteger(output[field]) || output[field] < 1) return invalid("invalid_request", `output.${field} must be a positive integer`);
    if (output[field] > LIMITS[field]) return invalid(code, `output.${field} is too large`);
  }

  const encoding = {
    default: typeof encodingInput.default === "string" ? encodingInput.default : DEFAULTS.encoding.default,
    rules: encodingInput.rules ?? [],
    onDecodeError: encodingInput.onDecodeError ?? DEFAULTS.encoding.onDecodeError,
  };
  if (!isSupportedEncoding(encoding.default)) return invalid("invalid_encoding", "encoding.default must be utf-8 or shift_jis");
  if (encoding.onDecodeError !== "skip") return invalid("invalid_request", "encoding.onDecodeError must be skip");
  if (!Array.isArray(encoding.rules)) return invalid("invalid_encoding_rule", "encoding.rules must be an array");
  for (const rule of encoding.rules) {
    if (
      !isPlainObject(rule) ||
      !isSupportedEncoding(rule.encoding) ||
      (!rule.pathPattern && !rule.fileNamePattern) ||
      (rule.pathPattern !== undefined && typeof rule.pathPattern !== "string") ||
      (rule.fileNamePattern !== undefined && typeof rule.fileNamePattern !== "string")
    ) {
      return invalid("invalid_encoding_rule", "encoding rule is invalid");
    }
    const ruleUnknown = findUnknownField(rule, { pathPattern: true, fileNamePattern: true, encoding: true });
    if (ruleUnknown) return invalid("unknown_field", `unknown field: encoding.rules[].${ruleUnknown}`);
  }

  const includeFileNamePatterns = search.includeFileNamePatterns as string[];
  const excludeFileNamePatterns = search.excludeFileNamePatterns as string[];
  const excludeDirNamePatterns = search.excludeDirNamePatterns as string[];
  const encodingRules = encoding.rules as EncodingRuleInput[];

  const effectiveRequest: EffectiveRequest = {
    root: request.root,
    query: { type: request.query.type as QueryType, text: request.query.text },
    search: {
      target: search.target as EffectiveRequest["search"]["target"],
      recursive: search.recursive as boolean,
      maxDepth: search.recursive ? (search.maxDepth as number) : 0,
      maxFileBytes: search.maxFileBytes as number,
      includeFileNamePatterns,
      excludeFileNamePatterns: [...DEFAULT_EXCLUDE_FILES, ...excludeFileNamePatterns],
      excludeDirNamePatterns: [...DEFAULT_EXCLUDE_DIRS, ...excludeDirNamePatterns],
    },
    output: {
      mode: output.mode as EffectiveRequest["output"]["mode"],
      maxMatches: output.maxMatches as number,
      maxMatchesPerFile: output.maxMatchesPerFile as number,
      maxLineLength: output.maxLineLength as number,
      maxSnippetsPerFile: output.maxSnippetsPerFile as number,
    },
    encoding: {
      default: encoding.default,
      rules: encodingRules,
      onDecodeError: "skip",
    },
  };
  return { ok: true, effectiveRequest };
}

function invalid(code: string, message: string, pathValue?: string): ValidationResult {
  return { ok: false, code, message, path: pathValue };
}

async function checkRoot(rootPath: string, requestRoot: string): Promise<{ ok: true } | { ok: false; diagnostic: Diagnostic }> {
  if (path.parse(rootPath).root === rootPath || rootPath === homeDirectory()) {
    return rootError("root_too_broad", "root is too broad", requestRoot);
  }
  try {
    const stat = await fs.stat(rootPath);
    if (!stat.isDirectory()) return rootError("root_not_accessible", "root is not a directory", requestRoot);
    await fs.access(rootPath, fsConstants.R_OK);
    return { ok: true };
  } catch (error) {
    const code = isNodeError(error) && error.code === "ENOENT" ? "root_not_found" : "root_not_accessible";
    return rootError(code, code === "root_not_found" ? "root does not exist" : "root is not accessible", requestRoot);
  }
}

function rootError(code: string, message: string, pathValue: string): { ok: false; diagnostic: Diagnostic } {
  return { ok: false, diagnostic: { severity: "error", code, message, path: pathValue } };
}

async function traverse(state: SearchState, absoluteDir: string, relativeDir: string, depth: number): Promise<void> {
  if (state.globalLimitReached) return;
  let entries;
  try {
    entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  } catch {
    state.diagnostics.push({ severity: "warning", code: "directory_not_readable", message: "directory could not be read and was skipped", path: relativeDir || ".", skipped: true });
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (state.globalLimitReached) return;
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    const absolutePath = path.join(absoluteDir, entry.name);
    if (entry.isSymbolicLink()) {
      state.diagnostics.push({ severity: "info", code: "symlink_skipped", message: "symlink was skipped", path: relativePath, skipped: true });
      continue;
    }
    if (entry.isDirectory()) {
      if (matchesAny(entry.name, state.request.search.excludeDirNamePatterns)) continue;
      if (!state.request.search.recursive || depth >= state.request.search.maxDepth) continue;
      await traverse(state, absolutePath, relativePath, depth + 1);
      continue;
    }
    if (!entry.isFile()) continue;
    state.summary.filesVisited += 1;
    if (!candidateFile(state, entry.name)) continue;
    await searchFile(state, absolutePath, relativePath, entry.name);
  }
}

function candidateFile(state: SearchState, basename: string): boolean {
  const { includeFileNamePatterns, excludeFileNamePatterns } = state.request.search;
  if (includeFileNamePatterns.length > 0 && !matchesAny(basename, includeFileNamePatterns)) return false;
  return !matchesAny(basename, excludeFileNamePatterns);
}

async function searchFile(state: SearchState, absolutePath: string, relativePath: string, basename: string): Promise<void> {
  const { target } = state.request.search;
  let countedScanned = false;
  if (target === "filename" || target === "both") {
    countedScanned = true;
    state.summary.filesScanned += 1;
    for (const hit of findMatches(relativePath, state.request.query)) {
      addHit(state, relativePath, { type: "filename", file: relativePath, matchedText: hit.text });
    }
  }
  if (target !== "content" && target !== "both") return;

  let stat;
  try {
    stat = await fs.stat(absolutePath);
  } catch {
    state.diagnostics.push({ severity: "warning", code: "file_not_readable", message: "file could not be read and was skipped", file: relativePath, skipped: true });
    return;
  }
  if (stat.size > state.request.search.maxFileBytes) {
    state.diagnostics.push({ severity: "warning", code: "max_file_bytes_exceeded", message: "file exceeded maxFileBytes and was skipped", file: relativePath, skipped: true, details: { size: stat.size, maxFileBytes: state.request.search.maxFileBytes } });
    return;
  }
  let bytes;
  try {
    bytes = await fs.readFile(absolutePath);
  } catch {
    state.diagnostics.push({ severity: "warning", code: "file_not_readable", message: "file could not be read and was skipped", file: relativePath, skipped: true });
    return;
  }
  if (bytes.includes(0)) {
    state.diagnostics.push({ severity: "warning", code: "binary_file_skipped", message: "binary file was skipped", file: relativePath, skipped: true });
    return;
  }

  const encodingInfo = selectEncoding(state.request.encoding, relativePath, basename);
  let text;
  try {
    text = decode(bytes, encodingInfo.encoding);
  } catch {
    state.diagnostics.push({ severity: "warning", code: "decode_error", message: "file could not be decoded and was skipped", file: relativePath, skipped: true, encoding: encodingInfo.encoding, encodingRule: encodingInfo.encodingRule });
    return;
  }
  if (!countedScanned) state.summary.filesScanned += 1;
  if (encodingInfo.encoding === "utf-8" && text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const lines = splitLines(text);
  let fileHitCount = state.summariesByFile.get(relativePath)?.matchCount ?? 0;
  for (let index = 0; index < lines.length; index += 1) {
    for (const match of findMatches(lines[index] ?? "", state.request.query)) {
      if (fileHitCount >= state.request.output.maxMatchesPerFile) {
        markTruncated(state, "max_matches_per_file", "file search stopped because maxMatchesPerFile was reached", { file: relativePath, maxMatchesPerFile: state.request.output.maxMatchesPerFile });
        return;
      }
      const line = lines[index] ?? "";
      const snippet = makeSnippet(line, match.index, match.text.length, state.request.output.maxLineLength);
      addHit(state, relativePath, {
        type: "content",
        file: relativePath,
        line: index + 1,
        column: match.index + 1,
        matchedText: match.text,
        text: snippet.text,
        trimmed: snippet.trimmed,
        ...(snippet.textStartColumn ? { textStartColumn: snippet.textStartColumn } : {}),
        encoding: encodingInfo.encoding,
        encodingRule: encodingInfo.encodingRule,
      });
      fileHitCount += 1;
      if (state.globalLimitReached) return;
    }
  }
}

function addHit(state: SearchState, file: string, hit: DetailMatch): void {
  if (state.summary.matches >= state.request.output.maxMatches) {
    markTruncated(state, "max_matches", "search stopped because maxMatches was reached", { maxMatches: state.request.output.maxMatches });
    state.globalLimitReached = true;
    return;
  }
  state.summary.matches += 1;
  const detail = state.detailsByFile.get(file) ?? [];
  detail.push(hit);
  state.detailsByFile.set(file, detail);

  const summary = state.summariesByFile.get(file) ?? {
    type: "file",
    file,
    matchTypes: [],
    filenameMatched: false,
    contentMatched: false,
    lines: [],
    matchCount: 0,
    snippets: [],
  };
  summary.matchCount += 1;
  if (hit.type === "filename") {
    summary.filenameMatched = true;
    if (!summary.matchTypes.includes("filename")) summary.matchTypes.push("filename");
  } else {
    summary.contentMatched = true;
    if (!summary.matchTypes.includes("content")) summary.matchTypes.push("content");
    if (!summary.lines.includes(hit.line)) summary.lines.push(hit.line);
    if (summary.snippets.length < state.request.output.maxSnippetsPerFile) {
      const snippet: FileSummaryMatch["snippets"][number] = { type: "content", line: hit.line, text: hit.text, trimmed: hit.trimmed };
      if (hit.textStartColumn) snippet.textStartColumn = hit.textStartColumn;
      summary.snippets.push(snippet);
    } else {
      markTruncated(state, "max_snippets_per_file", "snippets were omitted because maxSnippetsPerFile was reached", { file, maxSnippetsPerFile: state.request.output.maxSnippetsPerFile });
    }
    summary.encoding = hit.encoding;
    summary.encodingRule = hit.encodingRule;
  }
  state.summariesByFile.set(file, summary);
}

function markTruncated(state: SearchState, reason: string, message: string, details: Record<string, unknown>): void {
  if (!state.summary.truncated) {
    state.summary.truncated = true;
    state.summary.truncatedReason = reason;
  }
  const diagnosticKey = `${reason}:${JSON.stringify(details)}`;
  if (state.truncationDiagnosticKeys.has(diagnosticKey)) return;
  state.truncationDiagnosticKeys.add(diagnosticKey);
  state.diagnostics.push({ severity: "info", code: reason, message, details });
}

function buildDetailMatches(state: SearchState): DetailMatch[] {
  return [...state.detailsByFile.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([, hits]) => hits.sort((a, b) => typeRank(a.type) - typeRank(b.type) || ((a.type === "content" ? a.line : 0) - (b.type === "content" ? b.line : 0)) || ((a.type === "content" ? a.column : 0) - (b.type === "content" ? b.column : 0))));
}

function buildFileSummaryMatches(state: SearchState): FileSummaryMatch[] {
  return [...state.summariesByFile.values()]
    .sort((a, b) => a.file.localeCompare(b.file))
    .map((item) => ({ ...item, lines: item.lines.sort((a, b) => a - b) }));
}

function typeRank(type: DetailMatch["type"]): number {
  return type === "filename" ? 0 : 1;
}

function findMatches(text: string, query: { type: QueryType; text: string }): Array<{ index: number; text: string }> {
  if (query.type === "literal") {
    const hits: Array<{ index: number; text: string }> = [];
    let from = 0;
    while (from <= text.length) {
      const index = text.indexOf(query.text, from);
      if (index === -1) break;
      hits.push({ index, text: query.text });
      from = index + Math.max(query.text.length, 1);
    }
    return hits;
  }
  const regex = new RegExp(query.text, "g");
  const hits: Array<{ index: number; text: string }> = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    hits.push({ index: match.index, text: match[0] });
    if (match[0].length === 0) regex.lastIndex += 1;
  }
  return hits;
}

function makeSnippet(line: string, matchIndex: number, matchLength: number, maxLineLength: number): { text: string; trimmed: boolean; textStartColumn?: number } {
  if (line.length <= maxLineLength) return { text: line, trimmed: false };
  const matchEnd = matchIndex + matchLength;
  let start = Math.max(0, Math.floor((matchIndex + matchEnd - maxLineLength) / 2));
  if (start + maxLineLength > line.length) start = Math.max(0, line.length - maxLineLength);
  return { text: line.slice(start, start + maxLineLength), trimmed: true, ...(start > 0 ? { textStartColumn: start + 1 } : {}) };
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function selectEncoding(config: EffectiveRequest["encoding"], relativePath: string, basename: string): { encoding: SupportedEncoding; encodingRule: EncodingRuleResult } {
  for (const rule of config.rules) {
    if (rule.pathPattern && pathGlobMatch(relativePath, rule.pathPattern)) {
      return { encoding: rule.encoding, encodingRule: { type: "pathPattern", pattern: rule.pathPattern } };
    }
  }
  for (const rule of config.rules) {
    if (rule.fileNamePattern && globMatch(basename, rule.fileNamePattern)) {
      return { encoding: rule.encoding, encodingRule: { type: "fileNamePattern", pattern: rule.fileNamePattern } };
    }
  }
  return { encoding: config.default, encodingRule: { type: "default" } };
}

function decode(bytes: Uint8Array, encoding: SupportedEncoding): string {
  if (encoding === "utf-8") return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return iconv.decode(Buffer.from(bytes), "shift_jis");
}

function matchesAny(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => globMatch(value, pattern));
}

export function globMatch(value: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]");
  return new RegExp(`^${escaped}$`).test(value);
}

function pathGlobMatch(value: string, pattern: string): boolean {
  const escaped = pattern
    .split("/")
    .map((part) => {
      if (part === "**") return ".*";
      return part.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]");
    })
    .join("/");
  return new RegExp(`^${escaped}$`).test(value);
}

function sortDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics.sort((a, b) => (a.file ?? a.path ?? "").localeCompare(b.file ?? b.path ?? "") || ((a.line ?? 0) - (b.line ?? 0)) || a.code.localeCompare(b.code));
}

function findUnknownField(value: unknown, shape: Record<string, true | Record<string, unknown>>, prefix = ""): string | null {
  if (!isPlainObject(value)) return null;
  for (const key of Object.keys(value)) {
    if (!(key in shape)) return prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(shape[key]) && key !== "rules") {
      const nested = findUnknownField(value[key], shape[key] as Record<string, true | Record<string, unknown>>, prefix ? `${prefix}.${key}` : key);
      if (nested) return nested;
    }
  }
  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isSupportedEncoding(value: unknown): value is SupportedEncoding {
  return value === "utf-8" || value === "shift_jis";
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
