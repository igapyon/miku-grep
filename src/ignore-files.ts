import fs from "node:fs/promises";
import path from "node:path";
import { globMatch, pathGlobMatch } from "./glob.js";
import type { Diagnostic, EffectiveRequest, IgnoreLoadedSource, IgnoreSource } from "./public-types.js";

export type IgnoreRule = {
  sourcePath: string;
  baseDirectory: string;
  pattern: string;
  directoryOnly: boolean;
  anchored: boolean;
  hasSlash: boolean;
};

export async function loadIgnoreRulesForDirectory(
  request: EffectiveRequest,
  absoluteDir: string,
  relativeDir: string,
  diagnostics: Diagnostic[],
): Promise<IgnoreRule[]> {
  if (request.ignore.mode === "none") return [];
  const rules: IgnoreRule[] = [];
  for (const source of sourcesForDirectory(request.ignore.sources, relativeDir)) {
    const sourcePath = relativeDir ? `${relativeDir}/${source}` : source;
    const absolutePath = path.join(absoluteDir, source);
    let text: string;
    try {
      text = await fs.readFile(absolutePath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") continue;
      diagnostics.push({ severity: "warning", code: "ignore_file_not_readable", message: "ignore file could not be read and was skipped", path: sourcePath, skipped: true });
      continue;
    }
    const loaded: IgnoreLoadedSource = { path: sourcePath, baseDirectory: relativeDir || ".", patterns: 0, unsupportedPatterns: 0 };
    const parsed = parseIgnoreFile(text, sourcePath, relativeDir || ".", diagnostics, loaded);
    request.ignore.loadedSources.push(loaded);
    rules.push(...parsed);
  }
  return rules;
}

export function isIgnoredByRules(rules: IgnoreRule[], relativePath: string, isDirectory: boolean): boolean {
  return rules.some((rule) => ruleMatches(rule, relativePath, isDirectory));
}

function sourcesForDirectory(sources: IgnoreSource[], relativeDir: string): IgnoreSource[] {
  const local = sources.filter((source) => source === ".gitignore" || source === ".ignore");
  if (relativeDir) return local;
  return [...local, ...sources.filter((source) => source === ".git/info/exclude")];
}

function parseIgnoreFile(text: string, sourcePath: string, baseDirectory: string, diagnostics: Diagnostic[], loaded: IgnoreLoadedSource): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? "";
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (unsupportedPattern(trimmed)) {
      loaded.unsupportedPatterns += 1;
      diagnostics.push({
        severity: "warning",
        code: "unsupported_ignore_pattern",
        message: "ignore pattern is not supported and was skipped",
        path: sourcePath,
        line: index + 1,
        skipped: true,
        details: { pattern: trimmed },
      });
      continue;
    }
    const anchored = trimmed.startsWith("/");
    const directoryOnly = trimmed.endsWith("/");
    const pattern = trimmed.replace(/^\/+/, "").replace(/\/+$/, "");
    if (!pattern) continue;
    loaded.patterns += 1;
    rules.push({ sourcePath, baseDirectory, pattern, directoryOnly, anchored, hasSlash: pattern.includes("/") });
  }
  return rules;
}

function unsupportedPattern(pattern: string): boolean {
  return pattern.startsWith("!") || pattern.startsWith("\\#") || pattern.startsWith("\\!") || /[\[\]{}]/.test(pattern);
}

function ruleMatches(rule: IgnoreRule, relativePath: string, isDirectory: boolean): boolean {
  if (rule.directoryOnly && !isDirectory) return false;
  const relativeToBase = relativeFromBase(rule.baseDirectory, relativePath);
  if (relativeToBase === null || relativeToBase === "") return false;
  if (!rule.hasSlash && !rule.anchored) return globMatch(path.posix.basename(relativeToBase), rule.pattern);
  return pathGlobMatch(relativeToBase, rule.pattern);
}

function relativeFromBase(baseDirectory: string, relativePath: string): string | null {
  if (baseDirectory === ".") return relativePath;
  if (relativePath === baseDirectory) return "";
  const prefix = `${baseDirectory}/`;
  return relativePath.startsWith(prefix) ? relativePath.slice(prefix.length) : null;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
