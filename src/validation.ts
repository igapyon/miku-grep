import type { ValidationResult } from "./internal-types.js";
import { hasNestedQuantifiedGroup } from "./regex-safety.js";
import { DEFAULT_EXCLUDE_DIRS, DEFAULT_EXCLUDE_FILES, DEFAULTS, LIMITS, REQUEST_SHAPE, VERSION } from "./request-contract.js";
import type { EffectiveRequest, EncodingRuleInput, QueryType, SupportedEncoding } from "./public-types.js";

export { VERSION } from "./request-contract.js";

export function validateAndNormalize(request: unknown): ValidationResult {
  if (!isPlainObject(request)) return invalid("invalid_request", "request must be an object");
  const unknown = findUnknownField(request, REQUEST_SHAPE);
  if (unknown) return invalid("unknown_field", `unknown field: ${unknown}`);
  if (request.version !== VERSION) return invalid("invalid_version", "version must be 1");
  if (typeof request.root !== "string" || request.root.length === 0) return invalid("invalid_request", "root must be a non-empty string");
  if (!isPlainObject(request.query)) return invalid("invalid_request", "query must be an object");
  if (!["literal", "regex"].includes(String(request.query.type))) return invalid("invalid_query_type", "query.type must be literal or regex");
  if (typeof request.query.text !== "string") return invalid("invalid_request", "query.text must be a string");
  if (request.query.text.length === 0) return invalid("empty_query", "query.text must not be empty");
  if (request.query.type === "regex") {
    if (request.query.text.length > LIMITS.regexPatternLength) return invalid("regex_too_large", "query.text regex pattern is too large");
    try {
      new RegExp(request.query.text);
    } catch {
      return invalid("invalid_regex", "query.text is not a valid regular expression");
    }
    if (hasNestedQuantifiedGroup(request.query.text)) return invalid("unsafe_regex", "query.text regex pattern has nested quantified groups");
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
    maxLineChars: searchInput.maxLineChars ?? DEFAULTS.search.maxLineChars,
    maxFilesVisited: searchInput.maxFilesVisited ?? DEFAULTS.search.maxFilesVisited,
    maxDirectoriesVisited: searchInput.maxDirectoriesVisited ?? DEFAULTS.search.maxDirectoriesVisited,
    includeFileNamePatterns: searchInput.includeFileNamePatterns ?? [],
    excludeFileNamePatterns: searchInput.excludeFileNamePatterns ?? [],
    excludeDirNamePatterns: searchInput.excludeDirNamePatterns ?? [],
  };
  if (!["content", "filename", "both"].includes(search.target)) return invalid("invalid_search_target", "search.target must be content, filename, or both");
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
  };
  if (!["detail", "file-summary"].includes(output.mode)) return invalid("invalid_output_mode", "output.mode must be detail or file-summary");
  for (const [field, code] of [
    ["maxMatches", "max_matches_too_large"],
    ["maxMatchesPerFile", "max_matches_per_file_too_large"],
    ["maxLineLength", "max_line_length_too_large"],
    ["maxSnippetsPerFile", "max_snippets_per_file_too_large"],
  ] as const) {
    const check = validateIntegerLimit(output[field], `output.${field}`, 1, LIMITS[field], code);
    if (check) return check;
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
      maxLineChars: search.maxLineChars as number,
      maxFilesVisited: search.maxFilesVisited as number,
      maxDirectoriesVisited: search.maxDirectoriesVisited as number,
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

function isSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isSupportedEncoding(value: unknown): value is SupportedEncoding {
  return value === "utf-8" || value === "shift_jis";
}
