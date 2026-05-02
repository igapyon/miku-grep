import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { describe, expect, test } from "vitest";
import iconv from "iconv-lite";
import { helpText, main, runRequest } from "../src/main.js";

async function fixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.mkdir(path.join(root, "node_modules", "x"), { recursive: true });
  await fs.writeFile(path.join(root, "README.md"), "hello RepositoryMap\nsecond line\n", "utf8");
  await fs.writeFile(path.join(root, "src", "RepositoryMap.java"), "class RepositoryMap {\n  RepositoryMap field;\n}\n", "utf8");
  await fs.writeFile(path.join(root, "src", "legacy.txt"), iconv.encode("こんにちは RepositoryMap\n", "shift_jis"));
  await fs.writeFile(path.join(root, "node_modules", "x", "skip.js"), "RepositoryMap\n", "utf8");
  return root;
}

function writableCapture(): { stream: NodeJS.WritableStream; output: () => string } {
  const chunks: string[] = [];
  return {
    stream: {
      write(chunk: string | Uint8Array): boolean {
        chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
        return true;
      },
    } as NodeJS.WritableStream,
    output: () => chunks.join(""),
  };
}

function baseRequest(root: string): Record<string, unknown> {
  return {
    version: 1,
    root,
    query: { type: "literal", text: "RepositoryMap" },
  };
}

describe("miku-grep CLI request runner", () => {
  test("help text explains enough for agents to construct requests", () => {
    const text = helpText();

    expect(text).toContain("USAGE");
    expect(text).toContain("MINIMAL REQUEST");
    expect(text).toContain("REQUEST FIELDS");
    expect(text).toContain("RESULT SHAPE");
    expect(text).toContain("FULL STDIN / STDOUT EXAMPLE");
    expect(text).toContain("Possible successful output");
    expect(text).toContain("Possible validation error output");
    expect(text).toContain("COMMON DIAGNOSTIC CODES");
    expect(text).toContain('"version": 1');
    expect(text).toContain("search.target");
    expect(text).toContain("output.mode");
    expect(text).toContain("encoding.rules");
  });

  test("main returns exit 0 and stdout help for --help without reading stdin", async () => {
    const stdout = writableCapture();
    const stderr = writableCapture();
    const code = await main(["node", "miku-grep", "--help"], Readable.from([]), stdout.stream, stderr.stream);

    expect(code).toBe(0);
    expect(stderr.output()).toBe("");
    expect(stdout.output()).toContain("miku-grep - local-first structured grep CLI");
    expect(stdout.output()).toContain("MINIMAL REQUEST");
  });

  test("returns file-summary matches with defaults and excludes node_modules", async () => {
    const root = await fixture();
    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      search: { target: "content", recursive: true, maxDepth: 5 },
    });

    expect(result.ok).toBe(true);
    expect(result.effectiveRequest.output.mode).toBe("file-summary");
    expect(result.matches.map((match) => match.file)).toEqual(["README.md", "src/RepositoryMap.java"]);
    expect(result.summary.filesVisited).toBe(3);
    expect(result.summary.filesMatched).toBe(2);
    expect(result.summary.matches).toBe(3);
  });

  test("expands effectiveRequest defaults with stable key order", async () => {
    const root = await fixture();
    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
    });

    expect(result.ok).toBe(true);
    expect(Object.keys(result.effectiveRequest)).toEqual(["root", "query", "search", "output", "encoding"]);
    expect(Object.keys(result.effectiveRequest.search)).toEqual([
      "target",
      "recursive",
      "maxDepth",
      "maxFileBytes",
      "includeFileNamePatterns",
      "excludeFileNamePatterns",
      "excludeDirNamePatterns",
    ]);
    expect(Object.keys(result.effectiveRequest.output)).toEqual([
      "mode",
      "maxMatches",
      "maxMatchesPerFile",
      "maxLineLength",
      "maxSnippetsPerFile",
    ]);
    expect(Object.keys(result.effectiveRequest.encoding)).toEqual(["default", "rules", "onDecodeError"]);
    expect(result.effectiveRequest.search).toMatchObject({
      target: "content",
      recursive: true,
      maxDepth: 20,
      maxFileBytes: 10485760,
      includeFileNamePatterns: [],
    });
    expect(result.effectiveRequest.search.excludeFileNamePatterns).toEqual(
      expect.arrayContaining(["*.class", "*.jar", "*.zip", "*.png", "*.jpg", "*.jpeg", "*.gif", "*.pdf", ".classpath", ".project"]),
    );
    expect(result.effectiveRequest.search.excludeDirNamePatterns).toEqual(
      expect.arrayContaining([".git", ".svn", "node_modules", "target", "build", "dist", ".gradle", ".idea", ".vscode", ".settings", "vendor"]),
    );
    expect(result.effectiveRequest.output).toEqual({
      mode: "file-summary",
      maxMatches: 200,
      maxMatchesPerFile: 20,
      maxLineLength: 240,
      maxSnippetsPerFile: 3,
    });
    expect(result.effectiveRequest.encoding).toEqual({ default: "utf-8", rules: [], onDecodeError: "skip" });
  });

  test("returns detail filename hits before content hits for both target", async () => {
    const root = await fixture();
    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      search: { target: "both", recursive: true, maxDepth: 5 },
      output: { mode: "detail" },
    });

    expect(result.ok).toBe(true);
    const javaHits = result.matches.filter((match) => match.file === "src/RepositoryMap.java");
    expect(javaHits[0]?.type).toBe("filename");
    expect(javaHits[1]?.type).toBe("content");
    expect(javaHits[1]).toMatchObject({ line: 1, column: 7 });
  });

  test("sorts detail matches by file path and then filename before content hits", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.writeFile(path.join(root, "b-RepositoryMap.txt"), "RepositoryMap\n", "utf8");
    await fs.writeFile(path.join(root, "a-RepositoryMap.txt"), "x\nRepositoryMap\n", "utf8");

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      search: { target: "both" },
      output: { mode: "detail" },
    });

    expect(result.ok).toBe(true);
    expect(result.matches).toEqual([
      { type: "filename", file: "a-RepositoryMap.txt", matchedText: "RepositoryMap" },
      expect.objectContaining({ type: "content", file: "a-RepositoryMap.txt", line: 2, column: 1 }),
      { type: "filename", file: "b-RepositoryMap.txt", matchedText: "RepositoryMap" },
      expect.objectContaining({ type: "content", file: "b-RepositoryMap.txt", line: 1, column: 1 }),
    ]);
  });

  test("aggregates filename and content hits in file-summary mode", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "src", "RepositoryMap.java"), "class RepositoryMap {\n  RepositoryMap field;\n}\n", "utf8");

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      search: { target: "both" },
      output: { mode: "file-summary", maxSnippetsPerFile: 1 },
    });

    expect(result.ok).toBe(true);
    expect(result.matches).toEqual([
      expect.objectContaining({
        type: "file",
        file: "src/RepositoryMap.java",
        matchTypes: ["filename", "content"],
        filenameMatched: true,
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

  test("applies shift_jis encoding rules", async () => {
    const root = await fixture();
    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "こんにちは" },
      search: { target: "content", recursive: true },
      output: { mode: "detail" },
      encoding: {
        default: "utf-8",
        rules: [{ fileNamePattern: "legacy.txt", encoding: "shift_jis" }],
        onDecodeError: "skip",
      },
    });

    expect(result.ok).toBe(true);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({
      file: "src/legacy.txt",
      encoding: "shift_jis",
      encodingRule: { type: "fileNamePattern", pattern: "legacy.txt" },
    });
  });

  test("rejects unknown fields", async () => {
    const root = await fixture();
    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      typo: true,
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("unknown_field");
  });

  test.each([
    ["non-object request", null, "invalid_request"],
    ["non-object search", (root: string) => ({ ...baseRequest(root), search: [] }), "invalid_request"],
    ["non-object output", (root: string) => ({ ...baseRequest(root), output: [] }), "invalid_request"],
    ["non-object encoding", (root: string) => ({ ...baseRequest(root), encoding: [] }), "invalid_request"],
    ["non-string include pattern", (root: string) => ({ ...baseRequest(root), search: { includeFileNamePatterns: ["*.txt", 1] } }), "invalid_request"],
    ["non-string exclude file pattern", (root: string) => ({ ...baseRequest(root), search: { excludeFileNamePatterns: [false] } }), "invalid_request"],
    ["non-string exclude dir pattern", (root: string) => ({ ...baseRequest(root), search: { excludeDirNamePatterns: [{}] } }), "invalid_request"],
    ["unknown encoding rule field", (root: string) => ({ ...baseRequest(root), encoding: { rules: [{ fileNamePattern: "*.txt", encoding: "utf-8", extra: true }] } }), "unknown_field"],
  ])("rejects invalid request shape: %s", async (_caseName, createRequest, expectedCode) => {
    const root = await fixture();
    const request = typeof createRequest === "function" ? createRequest(root) : createRequest;
    const result = await runRequest(request);

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe(expectedCode);
  });

  test("rejects dangerous broad roots", async () => {
    const result = await runRequest({
      version: 1,
      root: path.parse(process.cwd()).root,
      query: { type: "literal", text: "RepositoryMap" },
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("root_too_broad");
    expect(result.diagnostics[0]).toMatchObject({ severity: "error", code: "root_too_broad" });
  });

  test("returns root_not_accessible when root is a file", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    const fileRoot = path.join(root, "not-dir.txt");
    await fs.writeFile(fileRoot, "RepositoryMap\n", "utf8");

    const result = await runRequest({
      version: 1,
      root: fileRoot,
      query: { type: "literal", text: "RepositoryMap" },
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("root_not_accessible");
    expect(result.diagnostics[0]).toMatchObject({ severity: "error", code: "root_not_accessible" });
  });

  test("rejects invalid regex and numeric limits", async () => {
    const root = await fixture();
    const invalidRegex = await runRequest({
      version: 1,
      root,
      query: { type: "regex", text: "[" },
    });
    const tooManyMatches = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      output: { maxMatches: 10001 },
    });

    expect(invalidRegex.ok).toBe(false);
    expect(invalidRegex.error?.code).toBe("invalid_regex");
    expect(tooManyMatches.ok).toBe(false);
    expect(tooManyMatches.error?.code).toBe("max_matches_too_large");
  });

  test.each([
    ["invalid_version", (root: string) => ({ ...baseRequest(root), version: 2 })],
    ["invalid_query_type", (root: string) => ({ ...baseRequest(root), query: { type: "glob", text: "RepositoryMap" } })],
    ["invalid_search_target", (root: string) => ({ ...baseRequest(root), search: { target: "path" } })],
    ["invalid_output_mode", (root: string) => ({ ...baseRequest(root), output: { mode: "raw" } })],
    ["max_depth_too_large", (root: string) => ({ ...baseRequest(root), search: { maxDepth: 51 } })],
    ["max_line_length_too_large", (root: string) => ({ ...baseRequest(root), output: { maxLineLength: 4001 } })],
    ["max_snippets_per_file_too_large", (root: string) => ({ ...baseRequest(root), output: { maxSnippetsPerFile: 101 } })],
    ["max_file_bytes_too_large", (root: string) => ({ ...baseRequest(root), search: { maxFileBytes: 104857601 } })],
    ["invalid_encoding", (root: string) => ({ ...baseRequest(root), encoding: { default: "euc-jp" } })],
    ["invalid_encoding_rule", (root: string) => ({ ...baseRequest(root), encoding: { rules: [{ fileNamePattern: "*.txt", encoding: "euc-jp" }] } })],
  ])("rejects requests with %s", async (expectedCode, createRequest) => {
    const root = await fixture();
    const result = await runRequest(createRequest(root));

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe(expectedCode);
    expect(result.diagnostics[0]).toMatchObject({ severity: "error", code: expectedCode });
  });

  test("reports maxFileBytes and NUL binary skips as diagnostics", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.writeFile(path.join(root, "big.txt"), "RepositoryMap\n");
    await fs.writeFile(path.join(root, "nul.bin"), Buffer.from([82, 0, 82]));

    const sizeLimited = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      search: { target: "content", maxFileBytes: 1 },
    });
    const binarySkipped = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "R" },
      search: { target: "content" },
    });

    expect(sizeLimited.ok).toBe(true);
    expect(sizeLimited.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "max_file_bytes_exceeded", file: "big.txt", skipped: true })]),
    );
    expect(binarySkipped.ok).toBe(true);
    expect(binarySkipped.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "binary_file_skipped", file: "nul.bin", skipped: true })]),
    );
  });

  test("default binary-like file patterns are excluded before content scanning", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.writeFile(path.join(root, "image.png"), "RepositoryMap\n", "utf8");
    await fs.writeFile(path.join(root, "archive.zip"), "RepositoryMap\n", "utf8");
    await fs.writeFile(path.join(root, "plain.txt"), "RepositoryMap\n", "utf8");

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      search: { target: "content" },
    });

    expect(result.ok).toBe(true);
    expect(result.matches.map((match) => match.file)).toEqual(["plain.txt"]);
    expect(result.summary.filesVisited).toBe(3);
    expect(result.summary.filesScanned).toBe(1);
    expect(result.diagnostics).toEqual([]);
  });

  test("reports skipped symlinks without following them", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.writeFile(path.join(root, "target.txt"), "RepositoryMap\n", "utf8");
    await fs.symlink(path.join(root, "target.txt"), path.join(root, "link.txt"));

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      search: { target: "content" },
    });

    expect(result.ok).toBe(true);
    expect(result.matches.map((match) => match.file)).toEqual(["target.txt"]);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ severity: "info", code: "symlink_skipped", path: "link.txt", skipped: true })]),
    );
  });

  test("applies include and exclude file name patterns by basename", async () => {
    const root = await fixture();
    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      search: {
        target: "content",
        includeFileNamePatterns: ["*.java", "*.md"],
        excludeFileNamePatterns: ["README.md"],
      },
    });

    expect(result.ok).toBe(true);
    expect(result.matches.map((match) => match.file)).toEqual(["src/RepositoryMap.java"]);
    expect(result.effectiveRequest.search.excludeFileNamePatterns).toContain("README.md");
  });

  test("filename search matches root-relative paths while include patterns match basenames", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "src", "App.java"), "no content hit\n", "utf8");
    await fs.writeFile(path.join(root, "App.java"), "no content hit\n", "utf8");

    const pathMatch = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "src/App.java" },
      search: { target: "filename", includeFileNamePatterns: ["App.java"] },
      output: { mode: "detail" },
    });
    const includeDoesNotMatchPath = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "App.java" },
      search: { target: "filename", includeFileNamePatterns: ["src/App.java"] },
      output: { mode: "detail" },
    });

    expect(pathMatch.ok).toBe(true);
    expect(pathMatch.matches).toEqual([
      { type: "filename", file: "src/App.java", matchedText: "src/App.java" },
    ]);
    expect(includeDoesNotMatchPath.ok).toBe(true);
    expect(includeDoesNotMatchPath.matches).toEqual([]);
    expect(includeDoesNotMatchPath.summary.filesScanned).toBe(0);
  });

  test("filename-only search does not read undecodable file contents", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.writeFile(path.join(root, "bad-name.txt"), Buffer.from([0xff, 0xfe, 0xfd]));

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "bad-name" },
      search: { target: "filename" },
      output: { mode: "detail" },
    });

    expect(result.ok).toBe(true);
    expect(result.matches).toEqual([{ type: "filename", file: "bad-name.txt", matchedText: "bad-name" }]);
    expect(result.diagnostics).toEqual([]);
    expect(result.summary.filesScanned).toBe(1);
  });

  test("both search reports filename hits and content diagnostics", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.writeFile(path.join(root, "RepositoryMap-bad.txt"), Buffer.from([0xff, 0xfe, 0xfd]));

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      search: { target: "both" },
      output: { mode: "detail" },
    });

    expect(result.ok).toBe(true);
    expect(result.matches).toEqual([{ type: "filename", file: "RepositoryMap-bad.txt", matchedText: "RepositoryMap" }]);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "decode_error", file: "RepositoryMap-bad.txt", skipped: true })]),
    );
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
      search: { target: "content", excludeDirNamePatterns: ["skip"] },
    });
    const nonRecursive = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      search: { target: "content", recursive: false },
    });

    expect(excludedDir.ok).toBe(true);
    expect(excludedDir.matches.map((match) => match.file)).toEqual(["keep/keep.txt", "root.txt"]);
    expect(nonRecursive.ok).toBe(true);
    expect(nonRecursive.matches.map((match) => match.file)).toEqual(["root.txt"]);
    expect(nonRecursive.effectiveRequest.search.maxDepth).toBe(0);
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
      search: { target: "content", recursive: true, maxDepth: 1 },
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

  test("reports decode errors and strips UTF-8 BOM before matching", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.writeFile(path.join(root, "bad.txt"), Buffer.from([0xff, 0xfe, 0xfd]));
    await fs.writeFile(path.join(root, "bom.txt"), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("RepositoryMap\n", "utf8")]));

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      output: { mode: "detail" },
    });

    expect(result.ok).toBe(true);
    expect(result.matches).toEqual([
      expect.objectContaining({ file: "bom.txt", line: 1, column: 1, matchedText: "RepositoryMap" }),
    ]);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "decode_error", file: "bad.txt", skipped: true })]),
    );
  });

  test("sorts diagnostics by path or file and then code", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.writeFile(path.join(root, "z-bad.txt"), Buffer.from([0xff, 0xfe, 0xfd]));
    await fs.writeFile(path.join(root, "target.txt"), "RepositoryMap\n", "utf8");
    await fs.symlink(path.join(root, "target.txt"), path.join(root, "a-link.txt"));

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
    });

    expect(result.ok).toBe(true);
    expect(result.diagnostics.map((diagnostic) => diagnostic.file ?? diagnostic.path)).toEqual(["a-link.txt", "z-bad.txt"]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["symlink_skipped", "decode_error"]);
  });

  test("returns root_not_found for missing roots", async () => {
    const root = path.join(os.tmpdir(), `miku-grep-missing-${Date.now()}-${Math.random()}`);
    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("root_not_found");
    expect(result.diagnostics[0]).toMatchObject({ severity: "error", code: "root_not_found" });
  });

  test("gives pathPattern encoding rules priority over fileNamePattern rules", async () => {
    const root = await fixture();
    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "こんにちは" },
      search: { target: "content", recursive: true },
      output: { mode: "detail" },
      encoding: {
        default: "utf-8",
        rules: [
          { pathPattern: "src/legacy.txt", encoding: "shift_jis" },
          { fileNamePattern: "legacy.txt", encoding: "utf-8" },
        ],
        onDecodeError: "skip",
      },
    });

    expect(result.ok).toBe(true);
    expect(result.matches[0]).toMatchObject({
      file: "src/legacy.txt",
      encodingRule: { type: "pathPattern", pattern: "src/legacy.txt" },
    });
  });

  test("emits maxSnippetsPerFile diagnostics once per file", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.writeFile(path.join(root, "many.txt"), "RepositoryMap\nRepositoryMap\nRepositoryMap\nRepositoryMap\n", "utf8");

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      output: { mode: "file-summary", maxSnippetsPerFile: 1 },
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

  test("main returns exit 0 and stdout JSON for valid requests", async () => {
    const root = await fixture();
    const stdout = writableCapture();
    const stderr = writableCapture();
    const code = await main(
      ["node", "miku-grep"],
      Readable.from([
        JSON.stringify({
          version: 1,
          root,
          query: { type: "literal", text: "RepositoryMap" },
          search: { target: "filename" },
        }),
      ]),
      stdout.stream,
      stderr.stream,
    );

    expect(code).toBe(0);
    expect(stderr.output()).toBe("");
    expect(JSON.parse(stdout.output())).toMatchObject({ version: 1, ok: true });
  });

  test("main returns exit 1 and stdout JSON for validation errors", async () => {
    const stdout = writableCapture();
    const stderr = writableCapture();
    const code = await main(
      ["node", "miku-grep"],
      Readable.from([JSON.stringify({ version: 1, root: ".", query: { type: "literal", text: "" } })]),
      stdout.stream,
      stderr.stream,
    );

    expect(code).toBe(1);
    expect(stderr.output()).toBe("");
    expect(JSON.parse(stdout.output())).toMatchObject({ ok: false, error: { code: "empty_query" } });
  });

  test("main returns exit 2 and stderr-only for malformed stdin", async () => {
    const stdout = writableCapture();
    const stderr = writableCapture();
    const code = await main(["node", "miku-grep"], Readable.from(["{"]), stdout.stream, stderr.stream);

    expect(code).toBe(2);
    expect(stdout.output()).toBe("");
    expect(stderr.output()).toContain("malformed stdin:");
  });

  test("main returns exit 2 and stderr-only for unknown options", async () => {
    const stdout = writableCapture();
    const stderr = writableCapture();
    const code = await main(["node", "miku-grep", "--unknown"], Readable.from([]), stdout.stream, stderr.stream);

    expect(code).toBe(2);
    expect(stdout.output()).toBe("");
    expect(stderr.output()).toContain("usage: miku-grep [--version|--help]");
  });

  test("dist CLI process returns exit 0 with parseable stdout JSON", async () => {
    const root = await fixture();
    const result = spawnSync(process.execPath, ["dist/main.js"], {
      input: `${JSON.stringify({
        version: 1,
        root,
        query: { type: "literal", text: "RepositoryMap" },
        search: { target: "filename" },
      })}\n`,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, version: 1 });
  });

  test("dist CLI process returns exit 1 with stdout JSON for validation errors", () => {
    const result = spawnSync(process.execPath, ["dist/main.js"], {
      input: `${JSON.stringify({ version: 1, root: ".", query: { type: "literal", text: "" } })}\n`,
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, error: { code: "empty_query" } });
  });
});
