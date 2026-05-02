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
});
