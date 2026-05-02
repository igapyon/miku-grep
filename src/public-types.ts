export type QueryType = "literal" | "regex";
export type SearchTarget = "content" | "filename" | "both";
export type OutputMode = "detail" | "file-summary";
export type SupportedEncoding = "utf-8" | "shift_jis";

export type MikuGrepRequest = {
  version: 1;
  root: string;
  query: {
    type: QueryType;
    text: string;
  };
  search?: {
    target?: SearchTarget;
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
  };
  encoding?: {
    default?: SupportedEncoding;
    rules?: EncodingRuleInput[];
    onDecodeError?: "skip";
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
    target: SearchTarget;
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
  };
  encoding: {
    default: SupportedEncoding;
    rules: EncodingRuleInput[];
    onDecodeError: "skip";
  };
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
      type: "filename";
      file: string;
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
      encoding: SupportedEncoding;
      encodingRule: EncodingRuleResult;
    };

export type FileSummaryMatch = {
  type: "file";
  file: string;
  matchTypes: Array<"filename" | "content">;
  filenameMatched: boolean;
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

export type Summary = {
  filesVisited: number;
  filesScanned: number;
  filesMatched: number;
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
  matches: Array<DetailMatch | FileSummaryMatch>;
  summary: Summary;
  diagnostics: Diagnostic[];
};
