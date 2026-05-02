import type { DetailMatch, Diagnostic, EffectiveRequest, FileSummaryMatch, Summary } from "./public-types.js";

export type ValidationResult =
  | { ok: true; effectiveRequest: EffectiveRequest }
  | { ok: false; code: string; message: string; path?: string; effectiveRequest?: EffectiveRequest | Record<string, never> };

export type SearchResult = {
  matches: Array<DetailMatch | FileSummaryMatch>;
  summary: Summary;
};

export type SearchState = {
  request: EffectiveRequest;
  rootPath: string;
  detailsByFile: Map<string, DetailMatch[]>;
  summariesByFile: Map<string, FileSummaryMatch>;
  diagnostics: Diagnostic[];
  truncationDiagnosticKeys: Set<string>;
  summary: Summary;
  directoriesVisited: number;
  globalLimitReached: boolean;
};
