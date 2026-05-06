import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { runRequest } from "../src/main.js";
import { baseRequest, fixture } from "./helpers.js";

describe("miku-grep request validation", () => {
  test("expands effectiveRequest defaults with stable key order", async () => {
    const root = await fixture();
    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
    });

    expect(result.ok).toBe(true);
    expect(Object.keys(result.effectiveRequest)).toEqual(["requestedRoot", "root", "detectGitRoot", "mode", "query", "search", "output", "encoding", "ignore"]);
    expect(result.effectiveRequest.requestedRoot).toBe(root);
    expect(result.effectiveRequest.root).toBe(root);
    expect(result.effectiveRequest.detectGitRoot).toBe(false);
    expect(result.effectiveRequest.mode).toBe("search");
    expect(Object.keys(result.effectiveRequest.search)).toEqual([
      "targets",
      "recursive",
      "maxDepth",
      "maxFileBytes",
      "maxLineChars",
      "maxFilesVisited",
      "maxDirectoriesVisited",
      "includeFileNamePatterns",
      "excludeFileNamePatterns",
      "excludeDirNamePatterns",
    ]);
    expect(Object.keys(result.effectiveRequest.output)).toEqual([
      "mode",
      "sort",
      "maxMatches",
      "maxMatchesPerFile",
      "maxLineLength",
      "maxSnippetsPerFile",
      "includeReadfileRequestHints",
      "contextLinesBefore",
      "contextLinesAfter",
    ]);
    expect(Object.keys(result.effectiveRequest.encoding)).toEqual(["preset", "default", "rules", "onDecodeError"]);
    expect(Object.keys(result.effectiveRequest.ignore)).toEqual(["mode", "sources", "useGlobalGitignore", "loadedSources"]);
    expect(result.effectiveRequest.query).toEqual({ type: "literal", text: "RepositoryMap", case: "sensitive" });
    expect(result.effectiveRequest.search).toMatchObject({
      targets: ["content"],
      recursive: true,
      maxDepth: 20,
      maxFileBytes: 10485760,
      maxLineChars: 1000000,
      maxFilesVisited: 100000,
      maxDirectoriesVisited: 10000,
      includeFileNamePatterns: [],
    });
    expect(result.effectiveRequest.search.excludeFileNamePatterns).toEqual(
      expect.arrayContaining(["*.class", "*.jar", "*.zip", "*.png", "*.jpg", "*.jpeg", "*.gif", "*.pdf", ".classpath", ".project"]),
    );
    expect(result.effectiveRequest.search.excludeDirNamePatterns).toEqual(
      expect.arrayContaining([".git", ".svn", "node_modules", "target", "build", "dist", ".gradle", ".idea", ".vscode", ".settings", "vendor"]),
    );
    expect(result.effectiveRequest.output).toEqual({
      mode: "summary",
      sort: "path",
      maxMatches: 200,
      maxMatchesPerFile: 20,
      maxLineLength: 240,
      maxSnippetsPerFile: 3,
      includeReadfileRequestHints: false,
      contextLinesBefore: 0,
      contextLinesAfter: 0,
    });
    expect(result.effectiveRequest.encoding).toEqual({ preset: null, default: "utf-8", rules: [], onDecodeError: "skip" });
    expect(result.effectiveRequest.ignore).toEqual({
      mode: "auto",
      sources: [".gitignore", ".ignore", ".git/info/exclude"],
      useGlobalGitignore: false,
      loadedSources: [],
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

  test("uses request exclude file patterns as replacement for default excludes", async () => {
    const root = await fixture();
    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      search: { excludeFileNamePatterns: [] },
    });

    expect(result.ok).toBe(true);
    expect(result.effectiveRequest.search.excludeFileNamePatterns).toEqual([]);
  });

  test("uses request exclude directory patterns as replacement for default excludes", async () => {
    const root = await fixture();
    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      search: { excludeDirNamePatterns: [] },
    });

    expect(result.ok).toBe(true);
    expect(result.effectiveRequest.search.excludeDirNamePatterns).toEqual([]);
  });

  test.each([
    ["non-object request", null, "invalid_request"],
    ["non-object search", (root: string) => ({ ...baseRequest(root), search: [] }), "invalid_request"],
    ["non-object output", (root: string) => ({ ...baseRequest(root), output: [] }), "invalid_request"],
    ["non-object encoding", (root: string) => ({ ...baseRequest(root), encoding: [] }), "invalid_request"],
    ["non-object ignore", (root: string) => ({ ...baseRequest(root), ignore: [] }), "invalid_request"],
    ["non-string include pattern", (root: string) => ({ ...baseRequest(root), search: { includeFileNamePatterns: ["*.txt", 1] } }), "invalid_request"],
    ["non-string exclude file pattern", (root: string) => ({ ...baseRequest(root), search: { excludeFileNamePatterns: [false] } }), "invalid_request"],
    ["non-string exclude dir pattern", (root: string) => ({ ...baseRequest(root), search: { excludeDirNamePatterns: [{}] } }), "invalid_request"],
    ["null exclude file pattern", (root: string) => ({ ...baseRequest(root), search: { excludeFileNamePatterns: null } }), "invalid_request"],
    ["null exclude dir pattern", (root: string) => ({ ...baseRequest(root), search: { excludeDirNamePatterns: null } }), "invalid_request"],
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

  test("can detect git root from a subdirectory", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.mkdir(path.join(root, ".git"), { recursive: true });
    await fs.mkdir(path.join(root, "packages", "app"), { recursive: true });
    await fs.writeFile(path.join(root, "README.md"), "RepositoryMap\n", "utf8");
    await fs.writeFile(path.join(root, "packages", "app", "local.txt"), "RepositoryMap\n", "utf8");
    const requestedRoot = path.join(root, "packages", "app");
    const expectedEffectiveRoot = (path.relative(process.cwd(), root) || ".").split(path.sep).join("/");

    const result = await runRequest({
      version: 1,
      root: requestedRoot,
      detectGitRoot: true,
      query: { type: "literal", text: "RepositoryMap" },
      search: { targets: ["content"] },
    });

    expect(result.ok).toBe(true);
    expect(result.effectiveRequest.requestedRoot).toBe(requestedRoot);
    expect(result.effectiveRequest.root).toBe(expectedEffectiveRoot);
    expect(result.effectiveRequest.detectGitRoot).toBe(true);
    expect(result.matches.map((match) => match.file)).toEqual(["README.md", "packages/app/local.txt"]);
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

  test("rejects oversized and nested quantified regex patterns", async () => {
    const root = await fixture();
    const tooLarge = await runRequest({
      version: 1,
      root,
      query: { type: "regex", text: "a".repeat(1001) },
    });
    const unsafe = await runRequest({
      version: 1,
      root,
      query: { type: "regex", text: "^(a+)+$" },
    });
    const charClassPlus = await runRequest({
      version: 1,
      root,
      query: { type: "regex", text: "^([a+])+$" },
    });

    expect(tooLarge.ok).toBe(false);
    expect(tooLarge.error?.code).toBe("regex_too_large");
    expect(unsafe.ok).toBe(false);
    expect(unsafe.error?.code).toBe("unsafe_regex");
    expect(charClassPlus.ok).toBe(true);
  });

  test.each([
    ["invalid_version", (root: string) => ({ ...baseRequest(root), version: 2 })],
    ["invalid_mode", (root: string) => ({ ...baseRequest(root), mode: "inventory" })],
    ["invalid_search_target", (root: string) => ({ ...baseRequest(root), query: { type: "glob", text: "**/*.md" } })],
    ["invalid_query_type", (root: string) => ({ version: 1, root, mode: "listFiles", query: { type: "literal", text: "RepositoryMap" } })],
    ["invalid_query_case", (root: string) => ({ ...baseRequest(root), query: { type: "literal", text: "RepositoryMap", case: "ignore" } })],
    ["invalid_search_target", (root: string) => ({ ...baseRequest(root), search: { targets: ["path"] } })],
    ["duplicate_search_target", (root: string) => ({ ...baseRequest(root), search: { targets: ["content", "content"] } })],
    ["invalid_output_mode", (root: string) => ({ ...baseRequest(root), output: { mode: "raw" } })],
    ["invalid_output_sort", (root: string) => ({ ...baseRequest(root), output: { sort: "score" } })],
    ["regex_too_large", (root: string) => ({ ...baseRequest(root), query: { type: "regex", text: "a".repeat(1001) } })],
    ["unsafe_regex", (root: string) => ({ ...baseRequest(root), query: { type: "regex", text: "^(a+)+$" } })],
    ["max_depth_too_large", (root: string) => ({ ...baseRequest(root), search: { maxDepth: 51 } })],
    ["max_line_chars_too_large", (root: string) => ({ ...baseRequest(root), search: { maxLineChars: 10000001 } })],
    ["max_files_visited_too_large", (root: string) => ({ ...baseRequest(root), search: { maxFilesVisited: 1000001 } })],
    ["max_directories_visited_too_large", (root: string) => ({ ...baseRequest(root), search: { maxDirectoriesVisited: 100001 } })],
    ["max_line_length_too_large", (root: string) => ({ ...baseRequest(root), output: { maxLineLength: 4001 } })],
    ["max_snippets_per_file_too_large", (root: string) => ({ ...baseRequest(root), output: { maxSnippetsPerFile: 101 } })],
    ["context_lines_too_large", (root: string) => ({ ...baseRequest(root), output: { mode: "detail", contextLines: 21 } })],
    ["invalid_context_lines", (root: string) => ({ ...baseRequest(root), output: { mode: "detail", contextLines: 1, contextLinesBefore: 1 } })],
    ["invalid_context_lines", (root: string) => ({ ...baseRequest(root), output: { mode: "summary", contextLines: 1 } })],
    ["invalid_context_lines", (root: string) => ({ ...baseRequest(root), output: { mode: "agent", contextLines: 1 } })],
    ["max_file_bytes_too_large", (root: string) => ({ ...baseRequest(root), search: { maxFileBytes: 104857601 } })],
    ["invalid_encoding", (root: string) => ({ ...baseRequest(root), encoding: { default: "euc-jp" } })],
    ["invalid_encoding_preset", (root: string) => ({ ...baseRequest(root), encoding: { preset: "auto" } })],
    ["invalid_encoding_rule", (root: string) => ({ ...baseRequest(root), encoding: { rules: [{ fileNamePattern: "*.txt", encoding: "euc-jp" }] } })],
    ["invalid_ignore_mode", (root: string) => ({ ...baseRequest(root), ignore: { mode: "always" } })],
    ["invalid_ignore_sources", (root: string) => ({ ...baseRequest(root), ignore: { sources: ".gitignore" } })],
    ["invalid_ignore_source", (root: string) => ({ ...baseRequest(root), ignore: { sources: ["custom.ignore"] } })],
    ["invalid_ignore_global", (root: string) => ({ ...baseRequest(root), ignore: { useGlobalGitignore: true } })],
    ["invalid_ignore_sources", (root: string) => ({ ...baseRequest(root), ignore: { mode: "none", sources: [".gitignore"] } })],
  ])("rejects requests with %s", async (expectedCode, createRequest) => {
    const root = await fixture();
    const result = await runRequest(createRequest(root));

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe(expectedCode);
    expect(result.diagnostics[0]).toMatchObject({ severity: "error", code: expectedCode });
  });
});
