import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { runRequest } from "../src/main.js";

describe("miku-grep ignore files", () => {
  test("respects root .gitignore by default for filepath and content targets", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.mkdir(path.join(root, "generated"), { recursive: true });
    await fs.writeFile(path.join(root, ".gitignore"), "generated/\n*.tmp\n", "utf8");
    await fs.writeFile(path.join(root, "keep.txt"), "RepositoryMap\n", "utf8");
    await fs.writeFile(path.join(root, "skip.tmp"), "RepositoryMap\n", "utf8");
    await fs.writeFile(path.join(root, "generated", "skip.txt"), "RepositoryMap\n", "utf8");

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      search: { targets: ["filepath", "content"] },
      output: { mode: "detail" },
    });

    expect(result.ok).toBe(true);
    expect(result.matches).toEqual([expect.objectContaining({ type: "content", file: "keep.txt" })]);
    expect(result.summary.filesIgnored).toBe(1);
    expect(result.summary.directoriesIgnored).toBe(1);
    expect(result.effectiveRequest.ignore.loadedSources).toEqual([
      { path: ".gitignore", baseDirectory: ".", patterns: 2, unsupportedPatterns: 0 },
    ]);
  });

  test("can disable ignore files with ignore mode none", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.writeFile(path.join(root, ".gitignore"), "*.tmp\n", "utf8");
    await fs.writeFile(path.join(root, "skip.tmp"), "RepositoryMap\n", "utf8");

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      search: { targets: ["content"] },
      ignore: { mode: "none" },
    });

    expect(result.ok).toBe(true);
    expect(result.matches).toEqual([expect.objectContaining({ type: "file", file: "skip.tmp" })]);
    expect(result.effectiveRequest.ignore).toEqual({ mode: "none", sources: [], useGlobalGitignore: false, loadedSources: [] });
  });

  test("applies nested .ignore files only below their directory", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.writeFile(path.join(root, "docs", ".ignore"), "draft.txt\n", "utf8");
    await fs.writeFile(path.join(root, "draft.txt"), "RepositoryMap\n", "utf8");
    await fs.writeFile(path.join(root, "docs", "draft.txt"), "RepositoryMap\n", "utf8");

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      search: { targets: ["content"] },
    });

    expect(result.ok).toBe(true);
    expect(result.matches).toEqual([expect.objectContaining({ type: "file", file: "draft.txt" })]);
    expect(result.summary.filesIgnored).toBe(1);
    expect(result.effectiveRequest.ignore.loadedSources).toEqual([
      { path: "docs/.ignore", baseDirectory: "docs", patterns: 1, unsupportedPatterns: 0 },
    ]);
  });

  test("supports negation patterns with last matching rule wins", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.writeFile(path.join(root, ".gitignore"), "*.tmp\n!keep.tmp\n", "utf8");
    await fs.writeFile(path.join(root, "keep.tmp"), "RepositoryMap\n", "utf8");
    await fs.writeFile(path.join(root, "skip.tmp"), "RepositoryMap\n", "utf8");
    await fs.writeFile(path.join(root, "keep.txt"), "RepositoryMap\n", "utf8");

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      search: { targets: ["content"] },
    });

    expect(result.ok).toBe(true);
    expect(result.matches.map((match) => match.file)).toEqual(["keep.tmp", "keep.txt"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.effectiveRequest.ignore.loadedSources).toEqual([
      { path: ".gitignore", baseDirectory: ".", patterns: 2, unsupportedPatterns: 0 },
    ]);
  });

  test("later ignore rules can override earlier negation patterns", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.writeFile(path.join(root, ".gitignore"), "!keep.tmp\n*.tmp\n", "utf8");
    await fs.writeFile(path.join(root, "keep.tmp"), "RepositoryMap\n", "utf8");
    await fs.writeFile(path.join(root, "keep.txt"), "RepositoryMap\n", "utf8");

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      search: { targets: ["content"] },
    });

    expect(result.ok).toBe(true);
    expect(result.matches).toEqual([expect.objectContaining({ type: "file", file: "keep.txt" })]);
    expect(result.effectiveRequest.ignore.loadedSources).toEqual([
      { path: ".gitignore", baseDirectory: ".", patterns: 2, unsupportedPatterns: 0 },
    ]);
  });

  test("requires parent directories to be unignored before nested files can be restored", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.mkdir(path.join(root, "generated"), { recursive: true });
    await fs.writeFile(path.join(root, ".gitignore"), "generated/\n!generated/\ngenerated/*\n!generated/keep.txt\n", "utf8");
    await fs.writeFile(path.join(root, "generated", "keep.txt"), "RepositoryMap\n", "utf8");
    await fs.writeFile(path.join(root, "generated", "skip.txt"), "RepositoryMap\n", "utf8");

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      search: { targets: ["content"] },
    });

    expect(result.ok).toBe(true);
    expect(result.matches).toEqual([expect.objectContaining({ type: "file", file: "generated/keep.txt" })]);
    expect(result.summary.filesIgnored).toBe(1);
    expect(result.summary.directoriesIgnored).toBe(0);
    expect(result.effectiveRequest.ignore.loadedSources).toEqual([
      { path: ".gitignore", baseDirectory: ".", patterns: 4, unsupportedPatterns: 0 },
    ]);
  });

  test("reports still-unsupported ignore patterns and skips only that pattern", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.writeFile(path.join(root, ".gitignore"), "[ab].tmp\n*.tmp\n", "utf8");
    await fs.writeFile(path.join(root, "a.tmp"), "RepositoryMap\n", "utf8");
    await fs.writeFile(path.join(root, "keep.txt"), "RepositoryMap\n", "utf8");

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      search: { targets: ["content"] },
    });

    expect(result.ok).toBe(true);
    expect(result.matches).toEqual([expect.objectContaining({ type: "file", file: "keep.txt" })]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ severity: "warning", code: "unsupported_ignore_pattern", path: ".gitignore", line: 1, skipped: true }),
    ]);
    expect(result.effectiveRequest.ignore.loadedSources).toEqual([
      { path: ".gitignore", baseDirectory: ".", patterns: 1, unsupportedPatterns: 1 },
    ]);
  });
});
