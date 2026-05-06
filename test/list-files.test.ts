import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { runRequest } from "../src/main.js";

describe("miku-grep listFiles mode", () => {
  test("lists files with summaries and default excludes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.mkdir(path.join(root, "a"), { recursive: true });
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
    await fs.writeFile(path.join(root, "README.md"), "readme\n", "utf8");
    await fs.writeFile(path.join(root, "a", "b.txt"), "nested\n", "utf8");
    await fs.writeFile(path.join(root, "a.txt"), "sibling\n", "utf8");
    await fs.writeFile(path.join(root, "docs", "guide.md"), "guide\n", "utf8");
    await fs.writeFile(path.join(root, "src", "main.ts"), "main\n", "utf8");
    await fs.writeFile(path.join(root, "node_modules", "pkg", "index.js"), "skip\n", "utf8");

    const result = await runRequest({
      version: 1,
      root,
      mode: "listFiles",
    });

    expect(result.ok).toBe(true);
    expect(result.effectiveRequest.mode).toBe("listFiles");
    expect(result.effectiveRequest).not.toHaveProperty("query");
    expect(result.matches).toEqual([]);
    expect(result.files).toEqual([
      { path: "README.md", extension: ".md", directory: "." },
      { path: "a.txt", extension: ".txt", directory: "." },
      { path: "a/b.txt", extension: ".txt", directory: "a" },
      { path: "docs/guide.md", extension: ".md", directory: "docs" },
      { path: "src/main.ts", extension: ".ts", directory: "src" },
    ]);
    expect(result.fileSummary).toEqual({
      files: 5,
      extensions: [
        { extension: ".md", count: 2 },
        { extension: ".txt", count: 2 },
        { extension: ".ts", count: 1 },
      ],
      directories: [
        { path: ".", count: 2 },
        { path: "a", count: 1 },
        { path: "docs", count: 1 },
        { path: "src", count: 1 },
      ],
    });
    expect(result.summary.filesVisited).toBe(5);
    expect(result.summary.filesScanned).toBe(5);
  });

  test("respects ignore files and include patterns", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.mkdir(path.join(root, "generated"), { recursive: true });
    await fs.writeFile(path.join(root, ".gitignore"), "generated/\n*.tmp\n", "utf8");
    await fs.writeFile(path.join(root, "keep.md"), "keep\n", "utf8");
    await fs.writeFile(path.join(root, "skip.tmp"), "skip\n", "utf8");
    await fs.writeFile(path.join(root, "generated", "skip.md"), "skip\n", "utf8");
    await fs.writeFile(path.join(root, "note.txt"), "note\n", "utf8");

    const result = await runRequest({
      version: 1,
      root,
      mode: "listFiles",
      search: { includeFileNamePatterns: ["*.md"] },
    });

    expect(result.ok).toBe(true);
    expect(result.files).toEqual([{ path: "keep.md", extension: ".md", directory: "." }]);
    expect(result.summary.filesIgnored).toBe(1);
    expect(result.summary.directoriesIgnored).toBe(1);
    expect(result.effectiveRequest.ignore.loadedSources).toEqual([
      { path: ".gitignore", baseDirectory: ".", patterns: 2, unsupportedPatterns: 0 },
    ]);
  });

  test("can filter listed files with glob query", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "README.md"), "readme\n", "utf8");
    await fs.writeFile(path.join(root, "docs", "guide.md"), "guide\n", "utf8");
    await fs.writeFile(path.join(root, "src", "main.ts"), "main\n", "utf8");

    const result = await runRequest({
      version: 1,
      root,
      mode: "listFiles",
      query: { type: "glob", text: "**/*.md" },
    });

    expect(result.ok).toBe(true);
    expect(result.files).toEqual([{ path: "docs/guide.md", extension: ".md", directory: "docs" }]);
    expect(result.fileSummary?.files).toBe(1);
    expect(result.summary.filesVisited).toBe(3);
    expect(result.summary.filesScanned).toBe(3);
  });

  test("rejects non-glob query in listFiles mode", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    const result = await runRequest({
      version: 1,
      root,
      mode: "listFiles",
      query: { type: "literal", text: "RepositoryMap" },
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("invalid_query_type");
  });
});
