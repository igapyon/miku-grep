import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import iconv from "iconv-lite";
import { runRequest } from "../src/main.js";

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

describe("miku-grep CLI request runner", () => {
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
});
