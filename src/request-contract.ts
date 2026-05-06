export const VERSION = 1;

export const DEFAULT_EXCLUDE_DIRS = [
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

export const DEFAULT_EXCLUDE_FILES = [
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

export const LIMITS = {
  regexPatternLength: 1000,
  maxDepth: 50,
  maxFileBytes: 104857600,
  maxLineChars: 10000000,
  maxFilesVisited: 1000000,
  maxDirectoriesVisited: 100000,
  maxMatches: 10000,
  maxMatchesPerFile: 1000,
  maxLineLength: 4000,
  maxSnippetsPerFile: 100,
  contextLines: 20,
};

export const DEFAULTS = {
  search: {
    targets: ["content"],
    recursive: true,
    maxDepth: 20,
    maxFileBytes: 10485760,
    maxLineChars: 1000000,
    maxFilesVisited: 100000,
    maxDirectoriesVisited: 10000,
    includeFileNamePatterns: [] as string[],
    excludeFileNamePatterns: [] as string[],
    excludeDirNamePatterns: [] as string[],
  },
  output: {
    mode: "summary",
    maxMatches: 200,
    maxMatchesPerFile: 20,
    maxLineLength: 240,
    maxSnippetsPerFile: 3,
    includeReadfileRequestHints: false,
    contextLinesBefore: 0,
    contextLinesAfter: 0,
  },
  encoding: {
    preset: null,
    default: "utf-8",
    rules: [],
    onDecodeError: "skip",
  },
  ignore: {
    mode: "auto",
    sources: [".gitignore", ".ignore", ".git/info/exclude"],
    useGlobalGitignore: false,
    loadedSources: [],
  },
} as const;

export const REQUEST_SHAPE = {
  version: true,
  root: true,
  detectGitRoot: true,
  mode: true,
  query: { type: true, text: true, case: true },
  search: {
    targets: true,
    recursive: true,
    maxDepth: true,
    maxFileBytes: true,
    maxLineChars: true,
    maxFilesVisited: true,
    maxDirectoriesVisited: true,
    includeFileNamePatterns: true,
    excludeFileNamePatterns: true,
    excludeDirNamePatterns: true,
  },
  output: {
    mode: true,
    maxMatches: true,
    maxMatchesPerFile: true,
    maxLineLength: true,
    maxSnippetsPerFile: true,
    includeReadfileRequestHints: true,
    contextLines: true,
    contextLinesBefore: true,
    contextLinesAfter: true,
  },
  encoding: { preset: true, default: true, rules: true, onDecodeError: true },
  ignore: { mode: true, sources: true, useGlobalGitignore: true },
} satisfies Record<string, true | Record<string, unknown>>;
