import type { ContextLine } from "./public-types.js";

export type ContextOptions = {
  contextLinesBefore: number;
  contextLinesAfter: number;
  maxLineChars: number;
  maxLineLength: number;
};

export function makeContext(
  lines: string[],
  matchIndex: number,
  options: ContextOptions,
  onLineSkipped: (line: number, lineChars: number) => void,
): { contextBefore?: ContextLine[]; contextAfter?: ContextLine[] } {
  const { contextLinesBefore, contextLinesAfter } = options;
  if (contextLinesBefore === 0 && contextLinesAfter === 0) return {};
  return {
    contextBefore: collectContextLines(lines, Math.max(0, matchIndex - contextLinesBefore), matchIndex, options, onLineSkipped),
    contextAfter: collectContextLines(lines, matchIndex + 1, Math.min(lines.length, matchIndex + 1 + contextLinesAfter), options, onLineSkipped),
  };
}

function collectContextLines(
  lines: string[],
  start: number,
  end: number,
  options: ContextOptions,
  onLineSkipped: (line: number, lineChars: number) => void,
): ContextLine[] {
  const context: ContextLine[] = [];
  for (let index = start; index < end; index += 1) {
    const line = lines[index] ?? "";
    if (line.length > options.maxLineChars) {
      onLineSkipped(index + 1, line.length);
      continue;
    }
    context.push(makeContextLine(line, index + 1, options.maxLineLength));
  }
  return context;
}

function makeContextLine(line: string, lineNumber: number, maxLineLength: number): ContextLine {
  if (line.length <= maxLineLength) return { line: lineNumber, text: line, trimmed: false };
  return { line: lineNumber, text: line.slice(0, maxLineLength), trimmed: true, textStartColumn: 1 };
}
