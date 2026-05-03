import fs from "node:fs/promises";
import path from "node:path";
import { makeContext } from "./context-lines.js";
import { decode, selectEncoding } from "./encoding.js";
import { matchesAny } from "./glob.js";
import { isIgnoredByRules, loadIgnoreRulesForDirectory } from "./ignore-files.js";
import { findMatches, makeSnippet, splitLines } from "./match-text.js";
import { isPathInsideOrSame } from "./path-security.js";
import { createSummary } from "./result.js";
import { addDirectoryHit, addFileHit, buildDetailMatches, buildSummaryMatches, markTruncated } from "./search-results.js";
import { compareStrings } from "./string-order.js";
import type { SearchResult, SearchState } from "./internal-types.js";
import type { IgnoreRule } from "./ignore-files.js";
import type {
  Diagnostic,
  EffectiveRequest,
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
      const context = makeContext(
        lines,
        index,
        {
          contextLinesBefore: state.request.output.contextLinesBefore,
          contextLinesAfter: state.request.output.contextLinesAfter,
          maxLineChars: state.request.search.maxLineChars,
          maxLineLength: state.request.output.maxLineLength,
        },
        (line, lineChars) => markLineSkipped(state, relativePath, line, lineChars),
      );
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

function hasTarget(state: SearchState, target: EffectiveRequest["search"]["targets"][number]): boolean {
  return state.request.search.targets.includes(target);
}
