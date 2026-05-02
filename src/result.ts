import type { DetailMatch, Diagnostic, EffectiveRequest, FileSummaryMatch, MikuGrepResult, Summary } from "./public-types.js";
import { VERSION } from "./validation.js";

export function createSummary(): Summary {
  return {
    filesVisited: 0,
    filesScanned: 0,
    filesMatched: 0,
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
  matches: Array<DetailMatch | FileSummaryMatch>,
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
  return diagnostics.sort((a, b) => (a.file ?? a.path ?? "").localeCompare(b.file ?? b.path ?? "") || ((a.line ?? 0) - (b.line ?? 0)) || a.code.localeCompare(b.code));
}
