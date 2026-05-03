import fs from "node:fs/promises";
import path from "node:path";
import iconv from "iconv-lite";
import { globMatch, matchesAny, pathGlobMatch } from "./glob.js";
import { isIgnoredByRules, loadIgnoreRulesForDirectory } from "./ignore-files.js";
import { isPathInsideOrSame } from "./path-security.js";
import { createSummary } from "./result.js";
import { compareStrings } from "./string-order.js";
import type { SearchResult, SearchState } from "./internal-types.js";
import type { IgnoreRule } from "./ignore-files.js";
import type {
  ContextLine,
  DetailMatch,
  Diagnostic,
  DirectorySummaryMatch,
  EffectiveRequest,
  EncodingRuleResult,
  FileSummaryMatch,
  QueryType,
  SupportedEncoding,
} from "./public-types.js";

export async function runSearch(request: EffectiveRequest, rootPath: string, diagnostics: Diagnostic[]): Promise<SearchResult> {
  const searchState: SearchState = {
    request,
    rootPath,
    detailsByFile: new Map(),
    detailsByDirectory: new Map(),
    summariesByFile: new Map(),
    summariesByDirectory: new Map(),
    diagnostics,
    truncationDiagnosticKeys: new Set(),
    summary: createSummary(),
    directoriesVisited: 0,
    globalLimitReached: false,
  };

  await traverse(searchState, rootPath, "", 0, []);
  const matches = request.output.mode === "detail" ? buildDetailMatches(searchState) : buildSummaryMatches(searchState);
  searchState.summary.filesMatched = searchState.summariesByFile.size;
  searchState.summary.directoriesMatched = searchState.summariesByDirectory.size;
  searchState.summary.diagnostics = diagnostics.length;
  return { matches, summary: searchState.summary };
}

async function traverse(state: SearchState, absoluteDir: string, relativeDir: string, depth: number, inheritedIgnoreRules: IgnoreRule[]): Promise<void> {
  if (state.globalLimitReached) return;
  if (state.directoriesVisited >= state.request.search.maxDirectoriesVisited) {
    markTruncated(state, "max_directories_visited", "search stopped because maxDirectoriesVisited was reached", { maxDirectoriesVisited: state.request.search.maxDirectoriesVisited });
    state.globalLimitReached = true;
    return;
  }
  state.directoriesVisited += 1;
  if (!relativeDir) state.summary.directoriesVisited += 1;

  const safeDir = await resolveInsideRoot(state, absoluteDir, relativeDir || ".");
  if (!safeDir) return;

  let entries;
  try {
    entries = await fs.readdir(safeDir, { withFileTypes: true });
  } catch {
    state.diagnostics.push({ severity: "warning", code: "directory_not_readable", message: "directory could not be read and was skipped", path: relativeDir || ".", skipped: true });
    return;
  }
  const ignoreRules = [...inheritedIgnoreRules, ...(await loadIgnoreRulesForDirectory(state.request, safeDir, relativeDir, state.diagnostics))];
  entries.sort((a, b) => compareStrings(a.name, b.name));
  for (const entry of entries) {
    if (state.globalLimitReached) return;
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    const absolutePath = path.join(safeDir, entry.name);
    if (entry.isSymbolicLink()) {
      state.diagnostics.push({ severity: "info", code: "symlink_skipped", message: "symlink was skipped", path: relativePath, skipped: true });
      continue;
    }
    if (entry.isDirectory()) {
      if (matchesAny(entry.name, state.request.search.excludeDirNamePatterns)) continue;
      if (isIgnoredByRules(ignoreRules, relativePath, true)) {
        state.summary.directoriesIgnored += 1;
        continue;
      }
      state.summary.directoriesVisited += 1;
      if (hasTarget(state, "directory")) {
        state.summary.directoriesScanned += 1;
        for (const hit of findMatches(relativePath, state.request.query)) {
          addDirectoryHit(state, relativePath, { type: "directory", path: relativePath, matchedText: hit.text });
        }
      }
      if (!state.request.search.recursive || depth >= state.request.search.maxDepth) continue;
      await traverse(state, absolutePath, relativePath, depth + 1, ignoreRules);
      continue;
    }
    if (!entry.isFile()) continue;
    if (state.summary.filesVisited >= state.request.search.maxFilesVisited) {
      markTruncated(state, "max_files_visited", "search stopped because maxFilesVisited was reached", { maxFilesVisited: state.request.search.maxFilesVisited });
      state.globalLimitReached = true;
      return;
    }
    state.summary.filesVisited += 1;
    if (isIgnoredByRules(ignoreRules, relativePath, false)) {
      state.summary.filesIgnored += 1;
      continue;
    }
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
  const searchFilepath = hasTarget(state, "filepath");
  const searchContent = hasTarget(state, "content");
  let countedScanned = false;
  if (searchFilepath) {
    countedScanned = true;
    state.summary.filesScanned += 1;
    for (const hit of findMatches(relativePath, state.request.query)) {
      addFileHit(state, relativePath, { type: "filepath", file: relativePath, matchedText: hit.text });
    }
  }
  if (!searchContent) return;

  const safePath = await resolveInsideRoot(state, absolutePath, relativePath);
  if (!safePath) return;

  let stat;
  try {
    const lstat = await fs.lstat(safePath);
    if (lstat.isSymbolicLink()) {
      state.diagnostics.push({ severity: "info", code: "symlink_skipped", message: "symlink was skipped", path: relativePath, skipped: true });
      return;
    }
    stat = await fs.stat(safePath);
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
    bytes = await fs.readFile(safePath);
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
    const line = lines[index] ?? "";
    if (line.length > state.request.search.maxLineChars) {
      markLineSkipped(state, relativePath, index + 1, line.length);
      continue;
    }
    for (const match of findMatches(line, state.request.query)) {
      if (fileHitCount >= state.request.output.maxMatchesPerFile) {
        markTruncated(state, "max_matches_per_file", "file search stopped because maxMatchesPerFile was reached", { file: relativePath, maxMatchesPerFile: state.request.output.maxMatchesPerFile });
        return;
      }
      const snippet = makeSnippet(line, match.index, match.text.length, state.request.output.maxLineLength);
      const context = makeContext(state, lines, index, relativePath);
      addFileHit(state, relativePath, {
        type: "content",
        file: relativePath,
        line: index + 1,
        column: match.index + 1,
        matchedText: match.text,
        text: snippet.text,
        trimmed: snippet.trimmed,
        ...(snippet.textStartColumn ? { textStartColumn: snippet.textStartColumn } : {}),
        ...context,
        encoding: encodingInfo.encoding,
        encodingRule: encodingInfo.encodingRule,
      });
      fileHitCount += 1;
      if (state.globalLimitReached) return;
    }
  }
}

function markLineSkipped(state: SearchState, file: string, line: number, lineChars: number): void {
  if (!state.summary.truncated) {
    state.summary.truncated = true;
    state.summary.truncatedReason = "max_line_chars_exceeded";
  }
  state.diagnostics.push({
    severity: "warning",
    code: "max_line_chars_exceeded",
    message: "line exceeded maxLineChars and was skipped",
    file,
    line,
    skipped: true,
    details: { lineChars, maxLineChars: state.request.search.maxLineChars },
  });
}

async function resolveInsideRoot(state: SearchState, absolutePath: string, relativePath: string): Promise<string | null> {
  let realPath;
  try {
    realPath = await fs.realpath(absolutePath);
  } catch {
    state.diagnostics.push({ severity: "warning", code: "file_not_readable", message: "path could not be resolved and was skipped", path: relativePath, skipped: true });
    return null;
  }
  if (!isPathInsideOrSame(realPath, state.rootPath)) {
    state.diagnostics.push({ severity: "warning", code: "path_escape_skipped", message: "path resolved outside root and was skipped", path: relativePath, skipped: true });
    return null;
  }
  return realPath;
}

function addFileHit(state: SearchState, file: string, hit: DetailMatch): void {
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
    filepathMatched: false,
    contentMatched: false,
    lines: [],
    matchCount: 0,
    snippets: [],
  };
  summary.matchCount += 1;
  if (hit.type === "filepath") {
    summary.filepathMatched = true;
    if (!summary.matchTypes.includes("filepath")) summary.matchTypes.push("filepath");
  } else if (hit.type === "content") {
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

function addDirectoryHit(state: SearchState, directoryPath: string, hit: DetailMatch): void {
  if (state.summary.matches >= state.request.output.maxMatches) {
    markTruncated(state, "max_matches", "search stopped because maxMatches was reached", { maxMatches: state.request.output.maxMatches });
    state.globalLimitReached = true;
    return;
  }
  state.summary.matches += 1;
  const detail = state.detailsByDirectory.get(directoryPath) ?? [];
  detail.push(hit);
  state.detailsByDirectory.set(directoryPath, detail);

  const summary = state.summariesByDirectory.get(directoryPath) ?? {
    type: "directory",
    path: directoryPath,
    matchTypes: ["directory"],
    directoryMatched: true,
    matchCount: 0,
  };
  summary.matchCount += 1;
  state.summariesByDirectory.set(directoryPath, summary);
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
  return [...state.detailsByDirectory.entries(), ...state.detailsByFile.entries()]
    .sort(([a], [b]) => compareStrings(a, b))
    .flatMap(([, hits]) => hits.sort((a, b) => typeRank(a.type) - typeRank(b.type) || ((a.type === "content" ? a.line : 0) - (b.type === "content" ? b.line : 0)) || ((a.type === "content" ? a.column : 0) - (b.type === "content" ? b.column : 0))));
}

function buildSummaryMatches(state: SearchState): Array<FileSummaryMatch | DirectorySummaryMatch> {
  return [...state.summariesByDirectory.values(), ...state.summariesByFile.values()]
    .sort((a, b) => compareStrings(summaryPath(a), summaryPath(b)))
    .map((item) => (item.type === "file" ? { ...item, lines: item.lines.sort((a, b) => a - b) } : item));
}

function typeRank(type: DetailMatch["type"]): number {
  if (type === "directory") return 0;
  if (type === "filepath") return 1;
  return 2;
}

function hasTarget(state: SearchState, target: EffectiveRequest["search"]["targets"][number]): boolean {
  return state.request.search.targets.includes(target);
}

function summaryPath(item: FileSummaryMatch | DirectorySummaryMatch): string {
  return item.type === "file" ? item.file : item.path;
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

function makeContext(state: SearchState, lines: string[], matchIndex: number, file: string): { contextBefore?: ContextLine[]; contextAfter?: ContextLine[] } {
  const { contextLinesBefore, contextLinesAfter } = state.request.output;
  if (contextLinesBefore === 0 && contextLinesAfter === 0) return {};
  return {
    contextBefore: collectContextLines(state, lines, Math.max(0, matchIndex - contextLinesBefore), matchIndex, file),
    contextAfter: collectContextLines(state, lines, matchIndex + 1, Math.min(lines.length, matchIndex + 1 + contextLinesAfter), file),
  };
}

function collectContextLines(state: SearchState, lines: string[], start: number, end: number, file: string): ContextLine[] {
  const context: ContextLine[] = [];
  for (let index = start; index < end; index += 1) {
    const line = lines[index] ?? "";
    if (line.length > state.request.search.maxLineChars) {
      markLineSkipped(state, file, index + 1, line.length);
      continue;
    }
    context.push(makeContextLine(line, index + 1, state.request.output.maxLineLength));
  }
  return context;
}

function makeContextLine(line: string, lineNumber: number, maxLineLength: number): ContextLine {
  if (line.length <= maxLineLength) return { line: lineNumber, text: line, trimmed: false };
  return { line: lineNumber, text: line.slice(0, maxLineLength), trimmed: true, textStartColumn: 1 };
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
