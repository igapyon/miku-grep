import fs from "node:fs/promises";
import path from "node:path";
import { matchesAny } from "./glob.js";
import { findMatches } from "./match-text.js";
import { isIgnoredByRules, loadIgnoreRulesForDirectory } from "./ignore-files.js";
import { isPathInsideOrSame } from "./path-security.js";
import { createSummary } from "./result.js";
import { compareStrings } from "./string-order.js";
import type { IgnoreRule } from "./ignore-files.js";
import type { ListFilesResult } from "./internal-types.js";
import type { Diagnostic, EffectiveRequest, FileListEntry, FileListSummary, Summary } from "./public-types.js";

type ListFilesState = {
  request: EffectiveRequest;
  rootPath: string;
  diagnostics: Diagnostic[];
  summary: Summary;
  files: FileListEntry[];
  directoriesEntered: number;
  globalLimitReached: boolean;
};

export async function runListFiles(request: EffectiveRequest, rootPath: string, diagnostics: Diagnostic[]): Promise<ListFilesResult> {
  const state: ListFilesState = {
    request,
    rootPath,
    diagnostics,
    summary: createSummary(),
    files: [],
    directoriesEntered: 0,
    globalLimitReached: false,
  };

  await traverse(state, rootPath, "", 0, []);
  state.files.sort((a, b) => compareStrings(a.path, b.path));
  state.summary.diagnostics = diagnostics.length;
  return { files: state.files, fileSummary: summarizeFiles(state.files), summary: state.summary };
}

async function traverse(state: ListFilesState, absoluteDir: string, relativeDir: string, depth: number, inheritedIgnoreRules: IgnoreRule[]): Promise<void> {
  if (state.globalLimitReached) return;
  if (state.directoriesEntered >= state.request.search.maxDirectoriesVisited) {
    markTruncated(state, "max_directories_visited", "file listing stopped because maxDirectoriesVisited was reached", { maxDirectoriesVisited: state.request.search.maxDirectoriesVisited });
    state.globalLimitReached = true;
    return;
  }
  state.directoriesEntered += 1;
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
      if (!state.request.search.recursive || depth >= state.request.search.maxDepth) continue;
      await traverse(state, absolutePath, relativePath, depth + 1, ignoreRules);
      continue;
    }
    if (!entry.isFile()) continue;
    if (state.summary.filesVisited >= state.request.search.maxFilesVisited) {
      markTruncated(state, "max_files_visited", "file listing stopped because maxFilesVisited was reached", { maxFilesVisited: state.request.search.maxFilesVisited });
      state.globalLimitReached = true;
      return;
    }
    state.summary.filesVisited += 1;
    if (isIgnoredByRules(ignoreRules, relativePath, false)) {
      state.summary.filesIgnored += 1;
      continue;
    }
    if (!candidateFile(state, entry.name)) continue;
    state.summary.filesScanned += 1;
    if (state.request.query && findMatches(relativePath, state.request.query).length === 0) continue;
    state.files.push({
      path: relativePath,
      extension: fileExtension(entry.name),
      directory: relativeDir || ".",
    });
  }
}

function candidateFile(state: ListFilesState, basename: string): boolean {
  const { includeFileNamePatterns, excludeFileNamePatterns } = state.request.search;
  if (includeFileNamePatterns.length > 0 && !matchesAny(basename, includeFileNamePatterns)) return false;
  return !matchesAny(basename, excludeFileNamePatterns);
}

async function resolveInsideRoot(state: ListFilesState, absolutePath: string, relativePath: string): Promise<string | null> {
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

function summarizeFiles(files: FileListEntry[]): FileListSummary {
  return {
    files: files.length,
    extensions: summarizeBy(files.map((file) => file.extension), "extension"),
    directories: summarizeBy(files.map((file) => file.directory), "path"),
  };
}

function summarizeBy<Key extends "extension" | "path">(values: string[], key: Key): Array<Record<Key, string> & { count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([a, aCount], [b, bCount]) => bCount - aCount || compareStrings(a, b))
    .map(([value, count]) => ({ [key]: value, count }) as Record<Key, string> & { count: number });
}

function fileExtension(basename: string): string {
  return path.posix.extname(basename).toLowerCase();
}

function markTruncated(state: ListFilesState, reason: string, message: string, details: Record<string, unknown>): void {
  if (!state.summary.truncated) {
    state.summary.truncated = true;
    state.summary.truncatedReason = reason;
  }
  state.diagnostics.push({ severity: "info", code: reason, message, details });
}
