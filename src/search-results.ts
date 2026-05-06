import { compareStrings } from "./string-order.js";
import type { SearchState } from "./internal-types.js";
import type { AgentDirectoryMatch, AgentFileMatch, DetailMatch, DirectorySummaryMatch, FileSummaryMatch, ReadRangeCandidate, RelevanceInfo } from "./public-types.js";

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
  return sortSummaryMatches([...state.summariesByDirectory.values(), ...state.summariesByFile.values()], state.request.output.sort).map((item) =>
    item.type === "file" ? { ...item, lines: item.lines.sort((a, b) => a - b) } : item,
  );
}

export function buildAgentMatches(state: SearchState): Array<AgentFileMatch | AgentDirectoryMatch> {
  return buildSummaryMatches(state).map((item) => {
    if (item.type === "directory") {
      return {
        type: "agentDirectory",
        path: item.path,
        targetKind: "directory",
        matchTypes: item.matchTypes,
        matchCount: item.matchCount,
        ...(item.relevance ? { relevance: item.relevance } : {}),
      };
    }
    const lines = item.lines.sort((a, b) => a - b);
    return {
      type: "agentFile",
      file: item.file,
      targetKind: "file",
      matchTypes: item.matchTypes,
      matchCount: item.matchCount,
      lines,
      representativeSnippets: item.snippets,
      readRanges: readRanges(lines),
      ...(item.relevance ? { relevance: item.relevance } : {}),
      ...(item.encoding ? { encoding: item.encoding } : {}),
      ...(item.encodingRule ? { encodingRule: item.encodingRule } : {}),
    };
  });
}

function typeRank(type: DetailMatch["type"]): number {
  if (type === "directory") return 0;
  if (type === "filepath") return 1;
  return 2;
}

function summaryPath(item: FileSummaryMatch | DirectorySummaryMatch): string {
  return item.type === "file" ? item.file : item.path;
}

function sortSummaryMatches(items: Array<FileSummaryMatch | DirectorySummaryMatch>, sort: "path" | "relevance"): Array<FileSummaryMatch | DirectorySummaryMatch> {
  if (sort === "path") return items.sort((a, b) => compareStrings(summaryPath(a), summaryPath(b)));
  return items
    .map((item) => ({ item: withRelevance(item), relevance: relevanceFor(item) }))
    .sort((a, b) => b.relevance.score - a.relevance.score || compareStrings(summaryPath(a.item), summaryPath(b.item)))
    .map(({ item }) => item);
}

function withRelevance(item: FileSummaryMatch | DirectorySummaryMatch): FileSummaryMatch | DirectorySummaryMatch {
  const relevance = relevanceFor(item);
  return { ...item, relevance };
}

function relevanceFor(item: FileSummaryMatch | DirectorySummaryMatch): RelevanceInfo {
  const candidatePath = summaryPath(item);
  const lowerPath = candidatePath.toLowerCase();
  const basename = lowerPath.split("/").at(-1) ?? lowerPath;
  const reasons: string[] = [];
  let score = 0;

  if (item.type === "file") {
    if (item.filepathMatched) {
      score += 40;
      reasons.push("filepath-match");
    }
    if (item.contentMatched) {
      score += 20;
      reasons.push("content-match");
    }
  } else {
    score += 15;
    reasons.push("directory-match");
  }

  const matchCountScore = Math.min(30, item.matchCount * 3);
  score += matchCountScore;
  reasons.push(`match-count:${item.matchCount}`);

  if (basename === "readme.md" || basename.startsWith("readme.")) {
    score += 30;
    reasons.push("readme");
  }
  if (lowerPath === "docs" || lowerPath.startsWith("docs/") || lowerPath.includes("/docs/")) {
    score += 20;
    reasons.push("docs-path");
  }
  if (lowerPath === "src" || lowerPath.startsWith("src/") || lowerPath.includes("/src/")) {
    score += 15;
    reasons.push("src-path");
  }
  if (lowerPath === "test" || lowerPath === "tests" || lowerPath.startsWith("test/") || lowerPath.startsWith("tests/") || lowerPath.includes("/test/") || lowerPath.includes("/tests/")) {
    score += 10;
    reasons.push("test-path");
  }
  if (isLowPriorityPath(lowerPath)) {
    score -= 40;
    reasons.push("generated-or-vendor-path");
  }

  return { score, reasons };
}

function isLowPriorityPath(lowerPath: string): boolean {
  return /(^|\/)(generated|vendor|node_modules|dist|build|target|coverage)(\/|$)/.test(lowerPath);
}

function readRanges(lines: number[]): ReadRangeCandidate[] {
  return lines.slice(0, 3).map((line) => ({
    startLine: Math.max(1, line - 5),
    endLine: line + 5,
    reason: "match",
  }));
}
