import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { runRequest } from "../src/main.js";
import { fixture } from "./helpers.js";

describe("miku-grep encoding and diagnostics", () => {
  test("applies shift_jis encoding rules", async () => {
    const root = await fixture();
    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "こんにちは" },
      search: { targets: ["content"], recursive: true },
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

  test("reports maxFileBytes and NUL binary skips as diagnostics", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.writeFile(path.join(root, "big.txt"), "RepositoryMap\n");
    await fs.writeFile(path.join(root, "nul.bin"), Buffer.from([82, 0, 82]));

    const sizeLimited = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      search: { targets: ["content"], maxFileBytes: 1 },
    });
    const binarySkipped = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "R" },
      search: { targets: ["content"] },
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
      search: { targets: ["content"] },
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
      search: { targets: ["content"] },
    });

    expect(result.ok).toBe(true);
    expect(result.matches.map((match) => match.file)).toEqual(["target.txt"]);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ severity: "info", code: "symlink_skipped", path: "link.txt", skipped: true })]),
    );
  });

  test("does not read files through symlinks that point outside request root", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-outside-"));
    await fs.writeFile(path.join(outside, "secret.txt"), "RepositoryMap\n", "utf8");
    await fs.symlink(outside, path.join(root, "outside"));

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
      search: { targets: ["content"] },
    });

    expect(result.ok).toBe(true);
    expect(result.matches).toEqual([]);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ severity: "info", code: "symlink_skipped", path: "outside", skipped: true })]),
    );
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
    expect(result.matches).toEqual([expect.objectContaining({ file: "bom.txt", line: 1, column: 1, matchedText: "RepositoryMap" })]);
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

  test("sorts diagnostics paths by deterministic code-unit order", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "miku-grep-test-"));
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.writeFile(path.join(root, "README-bad.txt"), Buffer.from([0xff, 0xfe, 0xfd]));
    await fs.writeFile(path.join(root, "target.txt"), "RepositoryMap\n", "utf8");
    await fs.symlink(path.join(root, "target.txt"), path.join(root, "docs", "link.txt"));

    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "RepositoryMap" },
    });

    expect(result.ok).toBe(true);
    expect(result.diagnostics.map((diagnostic) => diagnostic.file ?? diagnostic.path)).toEqual(["README-bad.txt", "docs/link.txt"]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["decode_error", "symlink_skipped"]);
  });

  test("gives pathPattern encoding rules priority over fileNamePattern rules", async () => {
    const root = await fixture();
    const result = await runRequest({
      version: 1,
      root,
      query: { type: "literal", text: "こんにちは" },
      search: { targets: ["content"], recursive: true },
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
});
