import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { runRequest } from "../src/main.js";

describe("miku-grep output limits", () => {
  test("emits maxSnippetsPerFile diagnostics once per file", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.writeFile(path.join(root, "many.txt"), "RepositoryMap\nRepositoryMap\nRepositoryMap\nRepositoryMap\n", "utf8");

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      output: { mode: "summary", maxSnippetsPerFile: 1 },
    });

    expect(result.ok).toBe(true);
    expect(result.summary.truncatedReason).toBe("max_snippets_per_file");
    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === "max_snippets_per_file")).toHaveLength(1);
  });

  test("stops at maxMatches with consistent summary and diagnostics", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.writeFile(path.join(root, "a.txt"), "RepositoryMap\nRepositoryMap\n", "utf8");
    await fs.writeFile(path.join(root, "b.txt"), "RepositoryMap\nRepositoryMap\n", "utf8");

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      output: { mode: "detail", maxMatches: 2 },
    });

    expect(result.ok).toBe(true);
    expect(result.matches).toHaveLength(2);
    expect(result.summary.matches).toBe(2);
    expect(result.summary.truncated).toBe(true);
    expect(result.summary.truncatedReason).toBe("max_matches");
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "max_matches", details: { maxMatches: 2 } })]),
    );
  });

  test("stops each file at maxMatchesPerFile while continuing traversal", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.writeFile(path.join(root, "a.txt"), "RepositoryMap\nRepositoryMap\n", "utf8");
    await fs.writeFile(path.join(root, "b.txt"), "RepositoryMap\nRepositoryMap\n", "utf8");

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      output: { mode: "detail", maxMatchesPerFile: 1 },
    });

    expect(result.ok).toBe(true);
    expect(result.matches.map((match) => match.file)).toEqual(["a.txt", "b.txt"]);
    expect(result.summary.matches).toBe(2);
    expect(result.summary.filesMatched).toBe(2);
    expect(result.summary.truncated).toBe(true);
    expect(result.summary.truncatedReason).toBe("max_matches_per_file");
    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === "max_matches_per_file")).toHaveLength(2);
  });

  test("stops traversal at maxFilesVisited", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.writeFile(path.join(root, "a.txt"), "RepositoryMap\n", "utf8");
    await fs.writeFile(path.join(root, "b.txt"), "RepositoryMap\n", "utf8");

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      search: { maxFilesVisited: 1 },
      output: { mode: "detail" },
    });

    expect(result.ok).toBe(true);
    expect(result.summary.filesVisited).toBe(1);
    expect(result.summary.truncated).toBe(true);
    expect(result.summary.truncatedReason).toBe("max_files_visited");
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "max_files_visited", details: { maxFilesVisited: 1 } })]),
    );
  });

  test("skips lines that exceed maxLineChars", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.writeFile(path.join(root, "long-line.txt"), `${"A".repeat(20)}RepositoryMap\nRepositoryMap\n`, "utf8");

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      search: { maxLineChars: 16 },
      output: { mode: "detail" },
    });

    expect(result.ok).toBe(true);
    expect(result.matches).toEqual([expect.objectContaining({ file: "long-line.txt", line: 2 })]);
    expect(result.summary.truncated).toBe(true);
    expect(result.summary.truncatedReason).toBe("max_line_chars_exceeded");
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "max_line_chars_exceeded", file: "long-line.txt", line: 1, skipped: true })]),
    );
  });

  test("stops traversal at maxDirectoriesVisited", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.mkdir(path.join(root, "a"), { recursive: true });
    await fs.mkdir(path.join(root, "b"), { recursive: true });
    await fs.writeFile(path.join(root, "a", "a.txt"), "RepositoryMap\n", "utf8");
    await fs.writeFile(path.join(root, "b", "b.txt"), "RepositoryMap\n", "utf8");

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      search: { maxDirectoriesVisited: 1 },
      output: { mode: "detail" },
    });

    expect(result.ok).toBe(true);
    expect(result.matches).toEqual([]);
    expect(result.summary.truncated).toBe(true);
    expect(result.summary.truncatedReason).toBe("max_directories_visited");
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "max_directories_visited", details: { maxDirectoriesVisited: 1 } })]),
    );
  });
});
