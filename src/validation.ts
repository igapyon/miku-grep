import type { ValidationResult } from "./internal-types.js";
import { hasNestedQuantifiedGroup } from "./regex-safety.js";
import { DEFAULT_EXCLUDE_DIRS, DEFAULT_EXCLUDE_FILES, DEFAULTS, LIMITS, REQUEST_SHAPE, VERSION } from "./request-contract.js";
import type { EffectiveRequest, EncodingPreset, EncodingRuleInput, IgnoreSource, QueryCase, QueryType, RequestMode, SearchTarget, SupportedEncoding } from "./public-types.js";

export { VERSION } from "./request-contract.js";

export function validateAndNormalize(request: unknown): ValidationResult {
  if (!isPlainObject(request)) return invalid("invalid_request", "request must be an object");
  const unknown = findUnknownField(request, REQUEST_SHAPE);
  if (unknown) return invalid("unknown_field", `unknown field: ${unknown}`);
  if (request.version !== VERSION) return invalid("invalid_version", "version must be 1");
  if (typeof request.root !== "string" || request.root.length === 0) return invalid("invalid_request", "root must be a non-empty string");
  const detectGitRoot = request.detectGitRoot ?? false;
  if (typeof detectGitRoot !== "boolean") return invalid("invalid_request", "detectGitRoot must be boolean");
  const mode = request.mode ?? "search";
  if (mode !== "search" && mode !== "listFiles") return invalid("invalid_mode", "mode must be search or listFiles");
  let query: EffectiveRequest["query"];
  if (mode === "search" || hasOwn(request, "query")) {
    if (!isPlainObject(request.query)) return invalid("invalid_request", "query must be an object");
    if (!["literal", "regex", "glob"].includes(String(request.query.type))) return invalid("invalid_query_type", "query.type must be literal, regex, or glob");
    if (typeof request.query.text !== "string") return invalid("invalid_request", "query.text must be a string");
    if (request.query.text.length === 0) return invalid("empty_query", "query.text must not be empty");
    const queryCase = request.query.case ?? "sensitive";
    if (queryCase !== "sensitive" && queryCase !== "insensitive") return invalid("invalid_query_case", "query.case must be sensitive or insensitive");
    if (mode === "listFiles" && request.query.type !== "glob") return invalid("invalid_query_type", "listFiles query.type must be glob");
    if (request.query.type === "regex") {
      if (request.query.text.length > LIMITS.regexPatternLength) return invalid("regex_too_large", "query.text regex pattern is too large");
      try {
        new RegExp(request.query.text);
      } catch {
        return invalid("invalid_regex", "query.text is not a valid regular expression");
      }
      if (hasNestedQuantifiedGroup(request.query.text)) return invalid("unsafe_regex", "query.text regex pattern has nested quantified groups");
    }
    query = { type: request.query.type as QueryType, text: request.query.text, case: queryCase as QueryCase };
  }

  const searchInput = request.search ?? {};
  const outputInput = request.output ?? {};
  const encodingInput = request.encoding ?? {};
  const ignoreInput = request.ignore ?? {};
  if (!isPlainObject(searchInput) || !isPlainObject(outputInput) || !isPlainObject(encodingInput) || !isPlainObject(ignoreInput)) {
    return invalid("invalid_request", "search, output, encoding, and ignore must be objects when specified");
  }

  const hasExcludeFileNamePatterns = hasOwn(searchInput, "excludeFileNamePatterns");
  const hasExcludeDirNamePatterns = hasOwn(searchInput, "excludeDirNamePatterns");
  const search = {
    targets: searchInput.targets ?? DEFAULTS.search.targets,
    recursive: searchInput.recursive ?? DEFAULTS.search.recursive,
    maxDepth: searchInput.maxDepth ?? DEFAULTS.search.maxDepth,
    maxFileBytes: searchInput.maxFileBytes ?? DEFAULTS.search.maxFileBytes,
    maxLineChars: searchInput.maxLineChars ?? DEFAULTS.search.maxLineChars,
    maxFilesVisited: searchInput.maxFilesVisited ?? DEFAULTS.search.maxFilesVisited,
    maxDirectoriesVisited: searchInput.maxDirectoriesVisited ?? DEFAULTS.search.maxDirectoriesVisited,
    includeFileNamePatterns: searchInput.includeFileNamePatterns ?? [],
    excludeFileNamePatterns: hasExcludeFileNamePatterns ? searchInput.excludeFileNamePatterns : DEFAULT_EXCLUDE_FILES,
    excludeDirNamePatterns: hasExcludeDirNamePatterns ? searchInput.excludeDirNamePatterns : DEFAULT_EXCLUDE_DIRS,
  };
  if (!isStringArray(search.targets) || search.targets.length === 0) return invalid("invalid_search_targets", "search.targets must be a non-empty array of filepath, directory, or content");
  for (const target of search.targets) {
    if (!isSearchTarget(target)) return invalid("invalid_search_target", "search.targets[] must be filepath, directory, or content");
  }
  if (new Set(search.targets).size !== search.targets.length) return invalid("duplicate_search_target", "search.targets must not contain duplicate values");
  if (mode === "search" && query?.type === "glob" && search.targets.includes("content")) return invalid("invalid_search_target", "query.type glob supports filepath and directory targets only");
  if (typeof search.recursive !== "boolean") return invalid("invalid_request", "search.recursive must be boolean");
  for (const check of [
    validateIntegerLimit(search.maxDepth, "search.maxDepth", 0, LIMITS.maxDepth, "max_depth_too_large"),
    validateIntegerLimit(search.maxFileBytes, "search.maxFileBytes", 0, LIMITS.maxFileBytes, "max_file_bytes_too_large"),
    validateIntegerLimit(search.maxLineChars, "search.maxLineChars", 1, LIMITS.maxLineChars, "max_line_chars_too_large"),
    validateIntegerLimit(search.maxFilesVisited, "search.maxFilesVisited", 1, LIMITS.maxFilesVisited, "max_files_visited_too_large"),
    validateIntegerLimit(search.maxDirectoriesVisited, "search.maxDirectoriesVisited", 1, LIMITS.maxDirectoriesVisited, "max_directories_visited_too_large"),
  ]) {
    if (check) return check;
  }
  for (const field of ["includeFileNamePatterns", "excludeFileNamePatterns", "excludeDirNamePatterns"] as const) {
    if (!isStringArray(search[field])) return invalid("invalid_request", `search.${field} must be an array of strings`);
  }

  const output = {
    mode: typeof outputInput.mode === "string" ? outputInput.mode : DEFAULTS.output.mode,
    maxMatches: outputInput.maxMatches ?? DEFAULTS.output.maxMatches,
    maxMatchesPerFile: outputInput.maxMatchesPerFile ?? DEFAULTS.output.maxMatchesPerFile,
    maxLineLength: outputInput.maxLineLength ?? DEFAULTS.output.maxLineLength,
    maxSnippetsPerFile: outputInput.maxSnippetsPerFile ?? DEFAULTS.output.maxSnippetsPerFile,
    includeReadfileRequestHints: outputInput.includeReadfileRequestHints ?? DEFAULTS.output.includeReadfileRequestHints,
    contextLines: outputInput.contextLines,
    contextLinesBefore: outputInput.contextLinesBefore,
    contextLinesAfter: outputInput.contextLinesAfter,
  };
  if (!["detail", "summary", "agent"].includes(output.mode)) return invalid("invalid_output_mode", "output.mode must be detail, summary, or agent");
  if (typeof output.includeReadfileRequestHints !== "boolean") return invalid("invalid_request", "output.includeReadfileRequestHints must be boolean");
  const hasContextLines = hasOwn(outputInput, "contextLines");
  const hasContextLinesBefore = hasOwn(outputInput, "contextLinesBefore");
  const hasContextLinesAfter = hasOwn(outputInput, "contextLinesAfter");
  const hasAnyContextOption = hasContextLines || hasContextLinesBefore || hasContextLinesAfter;
  if (output.mode !== "detail" && hasAnyContextOption) return invalid("invalid_context_lines", "context lines are only supported in detail mode");
  if (hasContextLines && (hasContextLinesBefore || hasContextLinesAfter)) {
    return invalid("invalid_context_lines", "output.contextLines cannot be combined with contextLinesBefore or contextLinesAfter");
  }
  const contextLinesBefore = hasContextLines ? output.contextLines : output.contextLinesBefore ?? DEFAULTS.output.contextLinesBefore;
  const contextLinesAfter = hasContextLines ? output.contextLines : output.contextLinesAfter ?? DEFAULTS.output.contextLinesAfter;
  for (const [field, code] of [
    ["maxMatches", "max_matches_too_large"],
    ["maxMatchesPerFile", "max_matches_per_file_too_large"],
    ["maxLineLength", "max_line_length_too_large"],
    ["maxSnippetsPerFile", "max_snippets_per_file_too_large"],
  ] as const) {
    const check = validateIntegerLimit(output[field], `output.${field}`, 1, LIMITS[field], code);
    if (check) return check;
  }
  for (const [value, fieldPath] of [
    [contextLinesBefore, hasContextLines ? "output.contextLines" : "output.contextLinesBefore"],
    [contextLinesAfter, hasContextLines ? "output.contextLines" : "output.contextLinesAfter"],
  ] as const) {
    const check = validateIntegerLimit(value, fieldPath, 0, LIMITS.contextLines, "context_lines_too_large");
    if (check) {
      if (!check.ok && check.code === "invalid_request") return invalid("invalid_context_lines", `${fieldPath} must be a non-negative integer`);
      return check;
    }
  }

  const encoding = {
    preset: encodingInput.preset ?? DEFAULTS.encoding.preset,
    default: typeof encodingInput.default === "string" ? encodingInput.default : DEFAULTS.encoding.default,
    rules: encodingInput.rules ?? [],
    onDecodeError: encodingInput.onDecodeError ?? DEFAULTS.encoding.onDecodeError,
  };
  if (encoding.preset !== null && encoding.preset !== "japanese-legacy") return invalid("invalid_encoding_preset", "encoding.preset must be japanese-legacy");
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

  const ignore = {
    mode: typeof ignoreInput.mode === "string" ? ignoreInput.mode : DEFAULTS.ignore.mode,
    sources: ignoreInput.sources ?? DEFAULTS.ignore.sources,
    useGlobalGitignore: ignoreInput.useGlobalGitignore ?? DEFAULTS.ignore.useGlobalGitignore,
  };
  if (!["auto", "none"].includes(ignore.mode)) return invalid("invalid_ignore_mode", "ignore.mode must be auto or none");
  if (ignore.mode === "none" && (hasOwn(ignoreInput, "sources") || hasOwn(ignoreInput, "useGlobalGitignore"))) {
    return invalid("invalid_ignore_sources", "ignore.sources and ignore.useGlobalGitignore cannot be specified when ignore.mode is none");
  }
  if (!isStringArray(ignore.sources)) return invalid("invalid_ignore_sources", "ignore.sources must be an array of strings");
  for (const source of ignore.sources) {
    if (!isIgnoreSource(source)) return invalid("invalid_ignore_source", "ignore.sources[] must be .gitignore, .ignore, or .git/info/exclude");
  }
  if (new Set(ignore.sources).size !== ignore.sources.length) return invalid("invalid_ignore_sources", "ignore.sources must not contain duplicate values");
  if (typeof ignore.useGlobalGitignore !== "boolean" || ignore.useGlobalGitignore) {
    return invalid("invalid_ignore_global", "ignore.useGlobalGitignore must be false");
  }

  const includeFileNamePatterns = search.includeFileNamePatterns as string[];
  const excludeFileNamePatterns = search.excludeFileNamePatterns as string[];
  const excludeDirNamePatterns = search.excludeDirNamePatterns as string[];
  const targets = search.targets as SearchTarget[];
  const encodingRules = encoding.rules as EncodingRuleInput[];
  const encodingPreset = encoding.preset as EncodingPreset | null;
  const ignoreSources = ignore.mode === "none" ? [] : (ignore.sources as IgnoreSource[]);

  const effectiveRequest: EffectiveRequest = {
    requestedRoot: request.root,
    root: request.root,
    detectGitRoot,
    mode: mode as RequestMode,
    ...(query ? { query } : {}),
    search: {
      targets,
      recursive: search.recursive as boolean,
      maxDepth: search.recursive ? (search.maxDepth as number) : 0,
      maxFileBytes: search.maxFileBytes as number,
      maxLineChars: search.maxLineChars as number,
      maxFilesVisited: search.maxFilesVisited as number,
      maxDirectoriesVisited: search.maxDirectoriesVisited as number,
      includeFileNamePatterns,
      excludeFileNamePatterns,
      excludeDirNamePatterns,
    },
    output: {
      mode: output.mode as EffectiveRequest["output"]["mode"],
      maxMatches: output.maxMatches as number,
      maxMatchesPerFile: output.maxMatchesPerFile as number,
      maxLineLength: output.maxLineLength as number,
      maxSnippetsPerFile: output.maxSnippetsPerFile as number,
      includeReadfileRequestHints: output.includeReadfileRequestHints as boolean,
      contextLinesBefore: contextLinesBefore as number,
      contextLinesAfter: contextLinesAfter as number,
    },
    encoding: {
      preset: encodingPreset,
      default: encoding.default,
      rules: encodingRules,
      onDecodeError: "skip",
    },
    ignore: {
      mode: ignore.mode as EffectiveRequest["ignore"]["mode"],
      sources: ignoreSources,
      useGlobalGitignore: false,
      loadedSources: [],
    },
  };
  return { ok: true, effectiveRequest };
}

function invalid(code: string, message: string, pathValue?: string): ValidationResult {
  return { ok: false, code, message, path: pathValue };
}

function validateIntegerLimit(value: unknown, fieldPath: string, minimum: 0 | 1, maximum: number, tooLargeCode: string): ValidationResult | null {
  if (!isSafeInteger(value) || value < minimum) {
    const kind = minimum === 0 ? "a non-negative integer" : "a positive integer";
    return invalid("invalid_request", `${fieldPath} must be ${kind}`);
  }
  if (value > maximum) return invalid(tooLargeCode, `${fieldPath} is too large`);
  return null;
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

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isSearchTarget(value: string): value is SearchTarget {
  return value === "filepath" || value === "directory" || value === "content";
}

function isIgnoreSource(value: string): value is IgnoreSource {
  return value === ".gitignore" || value === ".ignore" || value === ".git/info/exclude";
}

function isSupportedEncoding(value: unknown): value is SupportedEncoding {
  return value === "utf-8" || value === "shift_jis";
}
