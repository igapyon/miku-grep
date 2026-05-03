export type QueryType = "literal" | "regex";
export type SearchTarget = "filepath" | "directory" | "content";
export type OutputMode = "detail" | "summary";
export type SupportedEncoding = "utf-8" | "shift_jis";
export type IgnoreMode = "auto" | "none";
export type IgnoreSource = ".gitignore" | ".ignore" | ".git/info/exclude";

export type MikuGrepRequest = {
  version: 1;
  root: string;
  query: {
    type: QueryType;
    text: string;
  };
  search?: {
    targets?: SearchTarget[];
    recursive?: boolean;
    maxDepth?: number;
    maxFileBytes?: number;
    maxLineChars?: number;
    maxFilesVisited?: number;
    maxDirectoriesVisited?: number;
    includeFileNamePatterns?: string[];
    excludeFileNamePatterns?: string[];
    excludeDirNamePatterns?: string[];
  };
  output?: {
    mode?: OutputMode;
    maxMatches?: number;
    maxMatchesPerFile?: number;
    maxLineLength?: number;
    maxSnippetsPerFile?: number;
    contextLines?: number;
    contextLinesBefore?: number;
    contextLinesAfter?: number;
  };
  encoding?: {
    default?: SupportedEncoding;
    rules?: EncodingRuleInput[];
    onDecodeError?: "skip";
  };
  ignore?: {
    mode?: IgnoreMode;
    sources?: IgnoreSource[];
    useGlobalGitignore?: false;
  };
};

export type EncodingRuleInput = {
  pathPattern?: string;
  fileNamePattern?: string;
  encoding: SupportedEncoding;
};

export type EncodingRuleResult = {
  type: "pathPattern" | "fileNamePattern" | "default";
  pattern?: string;
};

export type EffectiveRequest = {
  root: string;
  query: {
    type: QueryType;
    text: string;
  };
  search: {
    targets: SearchTarget[];
    recursive: boolean;
    maxDepth: number;
    maxFileBytes: number;
    maxLineChars: number;
    maxFilesVisited: number;
    maxDirectoriesVisited: number;
    includeFileNamePatterns: string[];
    excludeFileNamePatterns: string[];
    excludeDirNamePatterns: string[];
  };
  output: {
    mode: OutputMode;
    maxMatches: number;
    maxMatchesPerFile: number;
    maxLineLength: number;
    maxSnippetsPerFile: number;
    contextLinesBefore: number;
    contextLinesAfter: number;
  };
  encoding: {
    default: SupportedEncoding;
    rules: EncodingRuleInput[];
    onDecodeError: "skip";
  };
  ignore: {
    mode: IgnoreMode;
    sources: IgnoreSource[];
    useGlobalGitignore: false;
    loadedSources: IgnoreLoadedSource[];
  };
};

export type IgnoreLoadedSource = {
  path: string;
  baseDirectory: string;
  patterns: number;
  unsupportedPatterns: number;
};

export type Diagnostic = {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  file?: string;
  path?: string;
  line?: number;
  skipped?: boolean;
  encoding?: SupportedEncoding;
  encodingRule?: EncodingRuleResult;
  details?: Record<string, unknown>;
};

export type DetailMatch =
  | {
      type: "filepath";
      file: string;
      matchedText: string;
    }
  | {
      type: "directory";
      path: string;
      matchedText: string;
    }
  | {
      type: "content";
      file: string;
      line: number;
      column: number;
      matchedText: string;
      text: string;
      trimmed: boolean;
      textStartColumn?: number;
      contextBefore?: ContextLine[];
      contextAfter?: ContextLine[];
      encoding: SupportedEncoding;
      encodingRule: EncodingRuleResult;
    };

export type ContextLine = {
  line: number;
  text: string;
  trimmed: boolean;
  textStartColumn?: number;
};

export type FileSummaryMatch = {
  type: "file";
  file: string;
  matchTypes: Array<"filepath" | "content">;
  filepathMatched: boolean;
  contentMatched: boolean;
  lines: number[];
  matchCount: number;
  snippets: Array<{
    type: "content";
    line: number;
    text: string;
    trimmed: boolean;
    textStartColumn?: number;
  }>;
  encoding?: SupportedEncoding;
  encodingRule?: EncodingRuleResult;
};

export type DirectorySummaryMatch = {
  type: "directory";
  path: string;
  matchTypes: ["directory"];
  directoryMatched: true;
  matchCount: number;
};

export type Summary = {
  filesVisited: number;
  directoriesVisited: number;
  filesScanned: number;
  directoriesScanned: number;
  filesMatched: number;
  directoriesMatched: number;
  filesIgnored: number;
  directoriesIgnored: number;
  matches: number;
  diagnostics: number;
  truncated: boolean;
  truncatedReason: string | null;
};

export type MikuGrepResult = {
  version: 1;
  ok: boolean;
  error: null | {
    code: string;
    message: string;
  };
  effectiveRequest: EffectiveRequest | Record<string, never>;
  matches: Array<DetailMatch | FileSummaryMatch | DirectorySummaryMatch>;
  summary: Summary;
  diagnostics: Diagnostic[];
};
