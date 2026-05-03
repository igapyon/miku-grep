import type { DetailMatch, Diagnostic, DirectorySummaryMatch, EffectiveRequest, FileSummaryMatch, MikuGrepResult, Summary } from "./public-types.js";
import { compareStrings } from "./string-order.js";
import { VERSION } from "./validation.js";

export function createSummary(): Summary {
  return {
    filesVisited: 0,
    directoriesVisited: 0,
    filesScanned: 0,
    directoriesScanned: 0,
    filesMatched: 0,
    directoriesMatched: 0,
    filesIgnored: 0,
    directoriesIgnored: 0,
    matches: 0,
    diagnostics: 0,
    truncated: false,
    truncatedReason: null,
  };
}

export function finish(
  ok: boolean,
  code: string | null,
  message: string | null,
  effectiveRequest: EffectiveRequest | Record<string, never>,
  matches: Array<DetailMatch | FileSummaryMatch | DirectorySummaryMatch>,
  summary: Summary,
  diagnostics: Diagnostic[],
): MikuGrepResult {
  return {
    version: VERSION,
    ok,
    error: ok ? null : { code: code ?? "invalid_request", message: message ?? "request failed" },
    effectiveRequest,
    matches,
    summary: { ...summary, diagnostics: diagnostics.length },
    diagnostics: sortDiagnostics(diagnostics),
  };
}

function sortDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics.sort((a, b) => compareStrings(a.file ?? a.path ?? "", b.file ?? b.path ?? "") || ((a.line ?? 0) - (b.line ?? 0)) || compareStrings(a.code, b.code));
}
