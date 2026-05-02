import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { runRequest } from "../src/main.js";
import { fixture } from "./helpers.js";

describe("miku-grep filename and combined search", () => {
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
    expect(pathMatch.matches).toEqual([{ type: "filename", file: "src/App.java", matchedText: "src/App.java" }]);
    expect(includeDoesNotMatchPath.ok).toBe(true);
    expect(includeDoesNotMatchPath.matches).toEqual([]);
    expect(includeDoesNotMatchPath.summary.filesScanned).toBe(0);
  });

  test("can include default-excluded zip files when exclude file patterns are empty", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.writeFile(path.join(root, "artifact.zip"), "not read for filename search\n", "utf8");

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "regex", text: "\\.zip$" },
      search: {
        target: "filename",
        includeFileNamePatterns: ["*.zip"],
        excludeFileNamePatterns: [],
      },
      output: { mode: "detail" },
    });

    expect(result.ok).toBe(true);
    expect(result.effectiveRequest.search.excludeFileNamePatterns).toEqual([]);
    expect(result.matches).toEqual([{ type: "filename", file: "artifact.zip", matchedText: ".zip" }]);
  });

  test("omitted exclude file patterns keep default zip exclusion", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.writeFile(path.join(root, "artifact.zip"), "not read for filename search\n", "utf8");

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "regex", text: "\\.zip$" },
      search: {
        target: "filename",
        includeFileNamePatterns: ["*.zip"],
      },
      output: { mode: "detail" },
    });

    expect(result.ok).toBe(true);
    expect(result.effectiveRequest.search.excludeFileNamePatterns).toContain("*.zip");
    expect(result.matches).toEqual([]);
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
});
