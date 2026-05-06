import type { AgentDirectoryMatch, AgentFileMatch, DetailMatch, Diagnostic, DirectorySummaryMatch, EffectiveRequest, FileListEntry, FileListSummary, FileSummaryMatch, Summary } from "./public-types.js";

export type ValidationResult =
  | { ok: true; effectiveRequest: EffectiveRequest }
  | { ok: false; code: string; message: string; path?: string; effectiveRequest?: EffectiveRequest | Record<string, never> };

export type SearchResult = {
  matches: Array<DetailMatch | FileSummaryMatch | DirectorySummaryMatch | AgentFileMatch | AgentDirectoryMatch>;
  summary: Summary;
};

export type ListFilesResult = {
  files: FileListEntry[];
  fileSummary: FileListSummary;
  summary: Summary;
};

export type SearchState = {
  request: EffectiveRequest;
  rootPath: string;
  detailsByFile: Map<string, DetailMatch[]>;
  detailsByDirectory: Map<string, DetailMatch[]>;
  summariesByFile: Map<string, FileSummaryMatch>;
  summariesByDirectory: Map<string, DirectorySummaryMatch>;
  diagnostics: Diagnostic[];
  truncationDiagnosticKeys: Set<string>;
  summary: Summary;
  directoriesVisited: number;
  globalLimitReached: boolean;
};
