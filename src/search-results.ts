import { compareStrings } from "./string-order.js";
import type { SearchState } from "./internal-types.js";
import type { DetailMatch, DirectorySummaryMatch, FileSummaryMatch } from "./public-types.js";

export function addFileHit(state: SearchState, file: string, hit: DetailMatch): void {
  if (state.summary.matches >= state.request.output.maxMatches) {
    markTruncated(state, "max_matches", "search stopped because maxMatches was reached", { maxMatches: state.request.output.maxMatches });
    state.globalLimitReached = true;
    return;
  }
  state.summary.matches += 1;
  const detail = state.detailsByFile.get(file) ?? [];
  detail.push(hit);
  state.detailsByFile.set(file, detail);

  const summary = state.summariesByFile.get(file) ?? {
    type: "file",
    file,
    matchTypes: [],
    filepathMatched: false,
    contentMatched: false,
    lines: [],
    matchCount: 0,
    snippets: [],
  };
  summary.matchCount += 1;
  if (hit.type === "filepath") {
    summary.filepathMatched = true;
    if (!summary.matchTypes.includes("filepath")) summary.matchTypes.push("filepath");
  } else if (hit.type === "content") {
    summary.contentMatched = true;
    if (!summary.matchTypes.includes("content")) summary.matchTypes.push("content");
    if (!summary.lines.includes(hit.line)) summary.lines.push(hit.line);
    if (summary.snippets.length < state.request.output.maxSnippetsPerFile) {
      const snippet: FileSummaryMatch["snippets"][number] = { type: "content", line: hit.line, text: hit.text, trimmed: hit.trimmed };
      if (hit.textStartColumn) snippet.textStartColumn = hit.textStartColumn;
      summary.snippets.push(snippet);
    } else {
      markTruncated(state, "max_snippets_per_file", "snippets were omitted because maxSnippetsPerFile was reached", { file, maxSnippetsPerFile: state.request.output.maxSnippetsPerFile });
    }
    summary.encoding = hit.encoding;
    summary.encodingRule = hit.encodingRule;
  }
  state.summariesByFile.set(file, summary);
}

export function addDirectoryHit(state: SearchState, directoryPath: string, hit: DetailMatch): void {
  if (state.summary.matches >= state.request.output.maxMatches) {
    markTruncated(state, "max_matches", "search stopped because maxMatches was reached", { maxMatches: state.request.output.maxMatches });
    state.globalLimitReached = true;
    return;
  }
  state.summary.matches += 1;
  const detail = state.detailsByDirectory.get(directoryPath) ?? [];
  detail.push(hit);
  state.detailsByDirectory.set(directoryPath, detail);

  const summary = state.summariesByDirectory.get(directoryPath) ?? {
    type: "directory",
    path: directoryPath,
    matchTypes: ["directory"],
    directoryMatched: true,
    matchCount: 0,
  };
  summary.matchCount += 1;
  state.summariesByDirectory.set(directoryPath, summary);
}

export function markTruncated(state: SearchState, reason: string, message: string, details: Record<string, unknown>): void {
  if (!state.summary.truncated) {
    state.summary.truncated = true;
    state.summary.truncatedReason = reason;
  }
  const diagnosticKey = `${reason}:${JSON.stringify(details)}`;
  if (state.truncationDiagnosticKeys.has(diagnosticKey)) return;
  state.truncationDiagnosticKeys.add(diagnosticKey);
  state.diagnostics.push({ severity: "info", code: reason, message, details });
}

export function buildDetailMatches(state: SearchState): DetailMatch[] {
  return [...state.detailsByDirectory.entries(), ...state.detailsByFile.entries()]
    .sort(([a], [b]) => compareStrings(a, b))
    .flatMap(([, hits]) => hits.sort((a, b) => typeRank(a.type) - typeRank(b.type) || ((a.type === "content" ? a.line : 0) - (b.type === "content" ? b.line : 0)) || ((a.type === "content" ? a.column : 0) - (b.type === "content" ? b.column : 0))));
}

export function buildSummaryMatches(state: SearchState): Array<FileSummaryMatch | DirectorySummaryMatch> {
  return [...state.summariesByDirectory.values(), ...state.summariesByFile.values()]
    .sort((a, b) => compareStrings(summaryPath(a), summaryPath(b)))
    .map((item) => (item.type === "file" ? { ...item, lines: item.lines.sort((a, b) => a - b) } : item));
}

function typeRank(type: DetailMatch["type"]): number {
  if (type === "directory") return 0;
  if (type === "filepath") return 1;
  return 2;
}

function summaryPath(item: FileSummaryMatch | DirectorySummaryMatch): string {
  return item.type === "file" ? item.file : item.path;
}
