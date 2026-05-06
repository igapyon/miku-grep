import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { runRequest } from "../src/main.js";
import { fixture } from "./helpers.js";

describe("miku-grep filepath, directory, and combined search", () => {
  test("returns directory detail hits for directory target", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.mkdir(path.join(root, "docs", "api"), { recursive: true });
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "docs", "readme.txt"), "not a directory hit\n", "utf8");

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "docs" },
      search: { targets: ["directory"] },
      output: { mode: "detail" },
    });

    expect(result.ok).toBe(true);
    expect(result.matches).toEqual([
      { type: "directory", path: "docs", matchedText: "docs" },
      { type: "directory", path: "docs/api", matchedText: "docs" },
    ]);
    expect(result.summary.directoriesScanned).toBe(3);
    expect(result.summary.directoriesMatched).toBe(2);
    expect(result.summary.filesScanned).toBe(0);
  });

  test("searches immediate directory entries when recursive is false", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.mkdir(path.join(root, "docs", "nested"), { recursive: true });

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "docs" },
      search: { targets: ["directory"], recursive: false },
      output: { mode: "detail" },
    });

    expect(result.ok).toBe(true);
    expect(result.matches).toEqual([{ type: "directory", path: "docs", matchedText: "docs" }]);
    expect(result.summary.directoriesVisited).toBe(2);
    expect(result.summary.directoriesScanned).toBe(1);
  });

  test("returns filepath and directory hits for find-like targets", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.writeFile(path.join(root, "docs.txt"), "not read\n", "utf8");
    await fs.writeFile(path.join(root, "docs", "guide.txt"), "not read\n", "utf8");

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "docs" },
      search: { targets: ["filepath", "directory"] },
      output: { mode: "detail" },
    });

    expect(result.ok).toBe(true);
    expect(result.matches).toEqual([
      { type: "directory", path: "docs", matchedText: "docs" },
      { type: "filepath", file: "docs.txt", matchedText: "docs" },
      { type: "filepath", file: "docs/guide.txt", matchedText: "docs" },
    ]);
  });

  test("filepath and directory search can be case-insensitive", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.mkdir(path.join(root, "Docs"), { recursive: true });
    await fs.writeFile(path.join(root, "Docs", "Guide.TXT"), "not read\n", "utf8");

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "docs", case: "insensitive" },
      search: { targets: ["filepath", "directory"] },
      output: { mode: "detail" },
    });

    expect(result.ok).toBe(true);
    expect(result.matches).toEqual([
      { type: "directory", path: "Docs", matchedText: "Docs" },
      { type: "filepath", file: "Docs/Guide.TXT", matchedText: "Docs" },
    ]);
  });

  test("aggregates directory hits in summary mode", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.mkdir(path.join(root, "docs", "api"), { recursive: true });

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "docs" },
      search: { targets: ["directory"] },
    });

    expect(result.ok).toBe(true);
    expect(result.matches).toEqual([
      {
        type: "directory",
        path: "docs",
        matchTypes: ["directory"],
        directoryMatched: true,
        matchCount: 1,
      },
      {
        type: "directory",
        path: "docs/api",
        matchTypes: ["directory"],
        directoryMatched: true,
        matchCount: 1,
      },
    ]);
  });

  test("returns agent directory candidates", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.mkdir(path.join(root, "docs", "api"), { recursive: true });

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "docs" },
      search: { targets: ["directory"] },
      output: { mode: "agent" },
    });

    expect(result.ok).toBe(true);
    expect(result.matches).toEqual([
      {
        type: "agentDirectory",
        path: "docs",
        targetKind: "directory",
        matchTypes: ["directory"],
        matchCount: 1,
      },
      {
        type: "agentDirectory",
        path: "docs/api",
        targetKind: "directory",
        matchTypes: ["directory"],
        matchCount: 1,
      },
    ]);
  });

  test("deduplicates readfile request hints for combined file targets", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.writeFile(path.join(root, "RepositoryMap.ts"), "RepositoryMap\n", "utf8");

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      search: { targets: ["filepath", "content"] },
      output: { mode: "detail", includeReadfileRequestHints: true },
    });

    expect(result.ok).toBe(true);
    expect(result.readfileHints).toEqual([
      {
        file: "RepositoryMap.ts",
        request: { version: 1, root, files: [{ path: "RepositoryMap.ts" }] },
      },
    ]);
  });

  test("returns detail filepath hits before content hits for combined targets", async () => {
    const root = await fixture();
    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      search: { targets: ["filepath", "content"], recursive: true, maxDepth: 5 },
      output: { mode: "detail" },
    });

    expect(result.ok).toBe(true);
    const javaHits = result.matches.filter((match) => match.file === "src/RepositoryMap.java");
    expect(javaHits[0]?.type).toBe("filepath");
    expect(javaHits[1]?.type).toBe("content");
    expect(javaHits[1]).toMatchObject({ line: 1, column: 7 });
  });

  test("sorts detail matches by file path and then filepath before content hits", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.writeFile(path.join(root, "b-RepositoryMap.txt"), "RepositoryMap\n", "utf8");
    await fs.writeFile(path.join(root, "a-RepositoryMap.txt"), "x\nRepositoryMap\n", "utf8");

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      search: { targets: ["filepath", "content"] },
      output: { mode: "detail" },
    });

    expect(result.ok).toBe(true);
    expect(result.matches).toEqual([
      { type: "filepath", file: "a-RepositoryMap.txt", matchedText: "RepositoryMap" },
      expect.objectContaining({ type: "content", file: "a-RepositoryMap.txt", line: 2, column: 1 }),
      { type: "filepath", file: "b-RepositoryMap.txt", matchedText: "RepositoryMap" },
      expect.objectContaining({ type: "content", file: "b-RepositoryMap.txt", line: 1, column: 1 }),
    ]);
  });

  test("sorts summary paths by deterministic code-unit order", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.writeFile(path.join(root, "README.md"), "readme\n", "utf8");
    await fs.writeFile(path.join(root, "docs", "development.md"), "development\n", "utf8");
    await fs.writeFile(path.join(root, "docs", "cli-json-parity.md"), "parity\n", "utf8");
    await fs.writeFile(path.join(root, "docs", "miku-grep-cli-spec.md"), "spec\n", "utf8");

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "regex", text: "\\.md$" },
      search: {
        targets: ["filepath"],
        recursive: true,
        maxDepth: 8,
      },
      output: {
        mode: "summary",
        maxMatches: 10000,
      },
    });

    expect(result.ok).toBe(true);
    expect(result.matches.map((match) => match.file)).toEqual([
      "README.md",
      "docs/cli-json-parity.md",
      "docs/development.md",
      "docs/miku-grep-cli-spec.md",
    ]);
  });

  test("sorts detail paths by deterministic code-unit order", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.writeFile(path.join(root, "README.md"), "readme\n", "utf8");
    await fs.writeFile(path.join(root, "docs", "development.md"), "development\n", "utf8");

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "regex", text: "\\.md$" },
      search: { targets: ["filepath"] },
      output: { mode: "detail" },
    });

    expect(result.ok).toBe(true);
    expect(result.matches).toEqual([
      { type: "filepath", file: "README.md", matchedText: ".md" },
      { type: "filepath", file: "docs/development.md", matchedText: ".md" },
    ]);
  });

  test("searches file paths with glob query", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "README.md"), "readme\n", "utf8");
    await fs.writeFile(path.join(root, "docs", "guide.md"), "guide\n", "utf8");
    await fs.writeFile(path.join(root, "src", "main.ts"), "main\n", "utf8");

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "glob", text: "**/*.md" },
      search: { targets: ["filepath"] },
      output: { mode: "detail" },
    });

    expect(result.ok).toBe(true);
    expect(result.matches).toEqual([{ type: "filepath", file: "docs/guide.md", matchedText: "docs/guide.md" }]);
  });

  test("searches directories with glob query", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.mkdir(path.join(root, "docs", "api"), { recursive: true });
    await fs.mkdir(path.join(root, "src", "api"), { recursive: true });

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "glob", text: "docs/**" },
      search: { targets: ["directory"] },
      output: { mode: "detail" },
    });

    expect(result.ok).toBe(true);
    expect(result.matches).toEqual([{ type: "directory", path: "docs/api", matchedText: "docs/api" }]);
  });

  test("returns at most one detail filepath hit per path", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.writeFile(path.join(root, "README.md"), "readme\n", "utf8");

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "regex", text: ".*" },
      search: { targets: ["filepath"] },
      output: { mode: "detail" },
    });

    expect(result.ok).toBe(true);
    expect(result.matches).toEqual([{ type: "filepath", file: "README.md", matchedText: "README.md" }]);
    expect(result.summary.matches).toBe(1);
  });

  test("returns at most one detail directory hit per path", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.mkdir(path.join(root, "docs"), { recursive: true });

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "regex", text: ".*" },
      search: { targets: ["directory"] },
      output: { mode: "detail" },
    });

    expect(result.ok).toBe(true);
    expect(result.matches).toEqual([{ type: "directory", path: "docs", matchedText: "docs" }]);
    expect(result.summary.matches).toBe(1);
  });

  test("keeps zero-length representative path hits when no non-empty hit exists", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "src", "foo.ts"), "no content hit\n", "utf8");

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "regex", text: "(?=foo)" },
      search: { targets: ["filepath"] },
      output: { mode: "detail" },
    });

    expect(result.ok).toBe(true);
    expect(result.matches).toEqual([{ type: "filepath", file: "src/foo.ts", matchedText: "" }]);
    expect(result.summary.matches).toBe(1);
  });

  test("aggregates filepath and content hits in summary mode", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "src", "RepositoryMap.java"), "class RepositoryMap {\n  RepositoryMap field;\n}\n", "utf8");

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      search: { targets: ["filepath", "content"] },
      output: { mode: "summary", maxSnippetsPerFile: 1 },
    });

    expect(result.ok).toBe(true);
    expect(result.matches).toEqual([
      expect.objectContaining({
        type: "file",
        file: "src/RepositoryMap.java",
        matchTypes: ["filepath", "content"],
        filepathMatched: true,
        contentMatched: true,
        lines: [1, 2],
        matchCount: 3,
        snippets: [{ type: "content", line: 1, text: "class RepositoryMap {", trimmed: false }],
        encoding: "utf-8",
        encodingRule: { type: "default" },
      }),
    ]);
    expect(result.summary.matches).toBe(3);
    expect(result.summary.filesMatched).toBe(1);
  });

  test("filepath search matches root-relative paths while include patterns match basenames", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "src", "App.java"), "no content hit\n", "utf8");
    await fs.writeFile(path.join(root, "App.java"), "no content hit\n", "utf8");

    const pathMatch = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "src/App.java" },
      search: { targets: ["filepath"], includeFileNamePatterns: ["App.java"] },
      output: { mode: "detail" },
    });
    const includeDoesNotMatchPath = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "App.java" },
      search: { targets: ["filepath"], includeFileNamePatterns: ["src/App.java"] },
      output: { mode: "detail" },
    });

    expect(pathMatch.ok).toBe(true);
    expect(pathMatch.matches).toEqual([{ type: "filepath", file: "src/App.java", matchedText: "src/App.java" }]);
    expect(includeDoesNotMatchPath.ok).toBe(true);
    expect(includeDoesNotMatchPath.matches).toEqual([]);
    expect(includeDoesNotMatchPath.summary.filesScanned).toBe(0);
  });

  test("can include default-excluded zip files when exclude file patterns are empty", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.writeFile(path.join(root, "artifact.zip"), "not read for filepath search\n", "utf8");

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "regex", text: "\\.zip$" },
      search: {
        targets: ["filepath"],
        includeFileNamePatterns: ["*.zip"],
        excludeFileNamePatterns: [],
      },
      output: { mode: "detail" },
    });

    expect(result.ok).toBe(true);
    expect(result.effectiveRequest.search.excludeFileNamePatterns).toEqual([]);
    expect(result.matches).toEqual([{ type: "filepath", file: "artifact.zip", matchedText: ".zip" }]);
  });

  test("omitted exclude file patterns keep default zip exclusion", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.writeFile(path.join(root, "artifact.zip"), "not read for filepath search\n", "utf8");

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "regex", text: "\\.zip$" },
      search: {
        targets: ["filepath"],
        includeFileNamePatterns: ["*.zip"],
      },
      output: { mode: "detail" },
    });

    expect(result.ok).toBe(true);
    expect(result.effectiveRequest.search.excludeFileNamePatterns).toContain("*.zip");
    expect(result.matches).toEqual([]);
  });

  test("filepath-only search does not read undecodable file contents", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.writeFile(path.join(root, "bad-name.txt"), Buffer.from([0xff, 0xfe, 0xfd]));

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "bad-name" },
      search: { targets: ["filepath"] },
      output: { mode: "detail" },
    });

    expect(result.ok).toBe(true);
    expect(result.matches).toEqual([{ type: "filepath", file: "bad-name.txt", matchedText: "bad-name" }]);
    expect(result.diagnostics).toEqual([]);
    expect(result.summary.filesScanned).toBe(1);
  });

  test("filepath and content search reports filepath hits and content diagnostics", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.writeFile(path.join(root, "RepositoryMap-bad.txt"), Buffer.from([0xff, 0xfe, 0xfd]));

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      search: { targets: ["filepath", "content"] },
      output: { mode: "detail" },
    });

    expect(result.ok).toBe(true);
    expect(result.matches).toEqual([{ type: "filepath", file: "RepositoryMap-bad.txt", matchedText: "RepositoryMap" }]);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "decode_error", file: "RepositoryMap-bad.txt", skipped: true })]),
    );
  });
});
