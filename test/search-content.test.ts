import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { runRequest } from "../src/main.js";
import { fixture } from "./helpers.js";

describe("miku-grep content search", () => {
  test("returns summary matches with defaults and excludes node_modules", async () => {
    const root = await fixture();
    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      search: { targets: ["content"], recursive: true, maxDepth: 5 },
    });

    expect(result.ok).toBe(true);
    expect(result.effectiveRequest.output.mode).toBe("summary");
    expect(result.matches.map((match) => match.file)).toEqual(["README.md", "src/RepositoryMap.java"]);
    expect(result.summary.filesVisited).toBe(3);
    expect(result.summary.filesMatched).toBe(2);
    expect(result.summary.matches).toBe(3);
  });

  test("regex content search is line-based and returns multiple hits", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.writeFile(path.join(root, "regex.txt"), "RepositoryMap RepositoryMap\nRepository\nMap\n", "utf8");

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "regex", text: "RepositoryMap" },
      output: { mode: "detail" },
    });

    expect(result.ok).toBe(true);
    expect(result.matches).toHaveLength(2);
    expect(result.matches).toEqual([
      expect.objectContaining({ file: "regex.txt", line: 1, column: 1, matchedText: "RepositoryMap" }),
      expect.objectContaining({ file: "regex.txt", line: 1, column: 15, matchedText: "RepositoryMap" }),
    ]);
  });

  test("regex search handles zero-length matches without hanging", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.writeFile(path.join(root, "zero.txt"), "ab\n", "utf8");

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "regex", text: "(?=a)|(?=b)" },
      output: { mode: "detail", maxMatchesPerFile: 10 },
    });

    expect(result.ok).toBe(true);
    expect(result.matches).toEqual([
      expect.objectContaining({ file: "zero.txt", line: 1, column: 1, matchedText: "" }),
      expect.objectContaining({ file: "zero.txt", line: 1, column: 2, matchedText: "" }),
    ]);
  });

  test("applies include and exclude file name patterns by basename", async () => {
    const root = await fixture();
    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      search: {
        targets: ["content"],
        includeFileNamePatterns: ["*.java", "*.md"],
        excludeFileNamePatterns: ["README.md"],
      },
    });

    expect(result.ok).toBe(true);
    expect(result.matches.map((match) => match.file)).toEqual(["src/RepositoryMap.java"]);
    expect(result.effectiveRequest.search.excludeFileNamePatterns).toContain("README.md");
  });

  test("applies exclude directory patterns and non-recursive traversal", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.mkdir(path.join(root, "keep"), { recursive: true });
    await fs.mkdir(path.join(root, "skip"), { recursive: true });
    await fs.writeFile(path.join(root, "root.txt"), "RepositoryMap\n", "utf8");
    await fs.writeFile(path.join(root, "keep", "keep.txt"), "RepositoryMap\n", "utf8");
    await fs.writeFile(path.join(root, "skip", "skip.txt"), "RepositoryMap\n", "utf8");

    const excludedDir = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      search: { targets: ["content"], excludeDirNamePatterns: ["skip"] },
    });
    const nonRecursive = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      search: { targets: ["content"], recursive: false },
    });

    expect(excludedDir.ok).toBe(true);
    expect(excludedDir.matches.map((match) => match.file)).toEqual(["keep/keep.txt", "root.txt"]);
    expect(nonRecursive.ok).toBe(true);
    expect(nonRecursive.matches.map((match) => match.file)).toEqual(["root.txt"]);
    expect(nonRecursive.effectiveRequest.search.maxDepth).toBe(0);
  });

  test("can include default-excluded directories when exclude directory patterns are empty", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
    await fs.writeFile(path.join(root, "node_modules", "pkg", "index.txt"), "RepositoryMap\n", "utf8");

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      search: { targets: ["content"], excludeDirNamePatterns: [] },
      output: { mode: "detail" },
    });

    expect(result.ok).toBe(true);
    expect(result.effectiveRequest.search.excludeDirNamePatterns).toEqual([]);
    expect(result.matches).toEqual([expect.objectContaining({ file: "node_modules/pkg/index.txt" })]);
  });

  test("omitted exclude directory patterns keep default node_modules exclusion", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
    await fs.writeFile(path.join(root, "node_modules", "pkg", "index.txt"), "RepositoryMap\n", "utf8");

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      search: { targets: ["content"] },
      output: { mode: "detail" },
    });

    expect(result.ok).toBe(true);
    expect(result.effectiveRequest.search.excludeDirNamePatterns).toContain("node_modules");
    expect(result.matches).toEqual([]);
  });

  test("applies maxDepth to recursive traversal", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.mkdir(path.join(root, "a", "b"), { recursive: true });
    await fs.writeFile(path.join(root, "root.txt"), "RepositoryMap\n", "utf8");
    await fs.writeFile(path.join(root, "a", "one.txt"), "RepositoryMap\n", "utf8");
    await fs.writeFile(path.join(root, "a", "b", "two.txt"), "RepositoryMap\n", "utf8");

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      search: { targets: ["content"], recursive: true, maxDepth: 1 },
    });

    expect(result.ok).toBe(true);
    expect(result.matches.map((match) => match.file)).toEqual(["a/one.txt", "root.txt"]);
  });

  test("trims snippets around matches without artificial ellipses", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.writeFile(path.join(root, "long.txt"), `${"a".repeat(20)}RepositoryMap${"z".repeat(20)}\n`, "utf8");

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      output: { mode: "detail", maxLineLength: 20 },
    });

    expect(result.ok).toBe(true);
    expect(result.matches[0]).toMatchObject({
      type: "content",
      trimmed: true,
      textStartColumn: 17,
      text: "aaaaRepositoryMapzzz",
    });
    expect("text" in result.matches[0] ? result.matches[0].text : "").not.toContain("...");
  });

  test("omits textStartColumn when a trimmed snippet starts at the first column", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.writeFile(path.join(root, "prefix.txt"), `RepositoryMap${"z".repeat(40)}\n`, "utf8");

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      output: { mode: "detail", maxLineLength: 20 },
    });

    expect(result.ok).toBe(true);
    expect(result.matches[0]).toMatchObject({
      type: "content",
      trimmed: true,
      text: "RepositoryMapzzzzzzz",
    });
    expect(result.matches[0]).not.toHaveProperty("textStartColumn");
  });

  test("normalizes LF, CRLF, and CR line endings for line numbers", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.writeFile(path.join(root, "lines.txt"), "one\nRepositoryMap\r\nthree\rRepositoryMap", "utf8");

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      output: { mode: "detail" },
    });

    expect(result.ok).toBe(true);
    expect(result.matches).toEqual([
      expect.objectContaining({ file: "lines.txt", line: 2, column: 1 }),
      expect.objectContaining({ file: "lines.txt", line: 4, column: 1 }),
    ]);
  });

  test("returns context lines for detail content hits", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.writeFile(path.join(root, "App.java"), "line 1\nline 2\nclass RepositoryMap {\nline 4\nline 5\n", "utf8");

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      search: { targets: ["content"] },
      output: { mode: "detail", contextLinesBefore: 2, contextLinesAfter: 1 },
    });

    expect(result.ok).toBe(true);
    expect(result.matches).toEqual([
      expect.objectContaining({
        type: "content",
        file: "App.java",
        line: 3,
        contextBefore: [
          { line: 1, text: "line 1", trimmed: false },
          { line: 2, text: "line 2", trimmed: false },
        ],
        contextAfter: [{ line: 4, text: "line 4", trimmed: false }],
      }),
    ]);
    expect(result.summary.matches).toBe(1);
  });

  test("returns empty context arrays at file boundaries when context is requested", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.writeFile(path.join(root, "App.java"), "RepositoryMap\nline 2\n", "utf8");

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      search: { targets: ["content"] },
      output: { mode: "detail", contextLines: 1 },
    });

    expect(result.ok).toBe(true);
    expect(result.matches[0]).toMatchObject({
      contextBefore: [],
      contextAfter: [{ line: 2, text: "line 2", trimmed: false }],
    });
  });

  test("omits context fields for filepath and directory hits", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.writeFile(path.join(root, "docs.txt"), "not read\n", "utf8");

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "docs" },
      search: { targets: ["filepath", "directory"] },
      output: { mode: "detail", contextLines: 2 },
    });

    expect(result.ok).toBe(true);
    expect(result.matches).toEqual([
      { type: "directory", path: "docs", matchedText: "docs" },
      { type: "filepath", file: "docs.txt", matchedText: "docs" },
    ]);
  });
});
