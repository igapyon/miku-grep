import type { ValidationResult } from "./internal-types.js";
import type { EffectiveRequest, EncodingRuleInput, QueryType, SupportedEncoding } from "./public-types.js";

export const VERSION = 1;

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
