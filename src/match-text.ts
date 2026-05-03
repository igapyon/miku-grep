import type { QueryType } from "./public-types.js";

export type TextMatch = {
  index: number;
  text: string;
};

export type Snippet = {
  text: string;
  trimmed: boolean;
  textStartColumn?: number;
};

export function findMatches(text: string, query: { type: QueryType; text: string }): TextMatch[] {
  if (query.type === "literal") {
    const hits: TextMatch[] = [];
    let from = 0;
    while (from <= text.length) {
      const index = text.indexOf(query.text, from);
      if (index === -1) break;
      hits.push({ index, text: query.text });
      from = index + Math.max(query.text.length, 1);
    }
    return hits;
  }
  const regex = new RegExp(query.text, "g");
  const hits: TextMatch[] = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    hits.push({ index: match.index, text: match[0] });
    if (match[0].length === 0) regex.lastIndex += 1;
  }
  return hits;
}

export function chooseRepresentativeMatch(matches: TextMatch[]): TextMatch | null {
  return matches.find((match) => match.text.length > 0) ?? matches[0] ?? null;
}

export function makeSnippet(line: string, matchIndex: number, matchLength: number, maxLineLength: number): Snippet {
  if (line.length <= maxLineLength) return { text: line, trimmed: false };
  const matchEnd = matchIndex + matchLength;
  let start = Math.max(0, Math.floor((matchIndex + matchEnd - maxLineLength) / 2));
  if (start + maxLineLength > line.length) start = Math.max(0, line.length - maxLineLength);
  return { text: line.slice(start, start + maxLineLength), trimmed: true, ...(start > 0 ? { textStartColumn: start + 1 } : {}) };
}

export function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}
