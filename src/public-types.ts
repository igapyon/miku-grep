export type QueryType = "literal" | "regex" | "glob";
export type QueryCase = "sensitive" | "insensitive";
export type RequestMode = "search" | "listFiles";
export type SearchTarget = "filepath" | "directory" | "content";
export type OutputMode = "detail" | "summary" | "agent";
export type OutputSort = "path" | "relevance";
export type SupportedEncoding = "utf-8" | "shift_jis";
export type EncodingPreset = "japanese-legacy";
export type IgnoreMode = "auto" | "none";
export type IgnoreSource = ".gitignore" | ".ignore" | ".git/info/exclude";

export type MikuGrepRequest = {
  version: 1;
  root: string;
  detectGitRoot?: boolean;
  mode?: RequestMode;
  query?: {
    type: QueryType;
    text: string;
    case?: QueryCase;
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
    sort?: OutputSort;
    maxMatches?: number;
    maxMatchesPerFile?: number;
    maxLineLength?: number;
    maxSnippetsPerFile?: number;
    includeReadfileRequestHints?: boolean;
    contextLines?: number;
    contextLinesBefore?: number;
    contextLinesAfter?: number;
  };
  encoding?: {
    preset?: EncodingPreset;
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
  type: "pathPattern" | "fileNamePattern" | "preset" | "default";
  pattern?: string;
  preset?: EncodingPreset;
};

export type EffectiveRequest = {
  requestedRoot: string;
  root: string;
  detectGitRoot: boolean;
  mode: RequestMode;
  query?: {
    type: QueryType;
    text: string;
    case: QueryCase;
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
    sort: OutputSort;
    maxMatches: number;
    maxMatchesPerFile: number;
    maxLineLength: number;
    maxSnippetsPerFile: number;
    includeReadfileRequestHints: boolean;
    contextLinesBefore: number;
    contextLinesAfter: number;
  };
  encoding: {
    preset: EncodingPreset | null;
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

export type RelevanceInfo = {
  score: number;
  reasons: string[];
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
  relevance?: RelevanceInfo;
  encoding?: SupportedEncoding;
  encodingRule?: EncodingRuleResult;
};

export type DirectorySummaryMatch = {
  type: "directory";
  path: string;
  matchTypes: ["directory"];
  directoryMatched: true;
  matchCount: number;
  relevance?: RelevanceInfo;
};

export type ReadRangeCandidate = {
  startLine: number;
  endLine: number;
  reason: "match";
};

export type AgentFileMatch = {
  type: "agentFile";
  file: string;
  targetKind: "file";
  matchTypes: Array<"filepath" | "content">;
  matchCount: number;
  lines: number[];
  representativeSnippets: FileSummaryMatch["snippets"];
  readRanges: ReadRangeCandidate[];
  relevance?: RelevanceInfo;
  encoding?: SupportedEncoding;
  encodingRule?: EncodingRuleResult;
};

export type AgentDirectoryMatch = {
  type: "agentDirectory";
  path: string;
  targetKind: "directory";
  matchTypes: ["directory"];
  matchCount: number;
  relevance?: RelevanceInfo;
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

export type FileListEntry = {
  path: string;
  extension: string;
  directory: string;
};

export type FileListSummary = {
  files: number;
  extensions: Array<{
    extension: string;
    count: number;
  }>;
  directories: Array<{
    path: string;
    count: number;
  }>;
};

export type ReadfileRequestHint = {
  file: string;
  request: {
    version: 1;
    root: string;
    files: Array<{
      path: string;
    }>;
  };
};

export type MikuGrepResult = {
  version: 1;
  ok: boolean;
  error: null | {
    code: string;
    message: string;
  };
  effectiveRequest: EffectiveRequest | Record<string, never>;
  matches: Array<DetailMatch | FileSummaryMatch | DirectorySummaryMatch | AgentFileMatch | AgentDirectoryMatch>;
  files?: FileListEntry[];
  fileSummary?: FileListSummary;
  readfileHints?: ReadfileRequestHint[];
  summary: Summary;
  diagnostics: Diagnostic[];
};
