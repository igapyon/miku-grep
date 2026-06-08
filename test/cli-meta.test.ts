import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { describe, expect, test } from "vitest";
import { helpText, main } from "../src/main.js";
import { fixture, stdinFromJson, writableCapture } from "./helpers.js";

describe("miku-grep CLI meta and stdio contract", () => {
  test("help text explains enough for agents to construct requests", () => {
    const text = helpText();

    expect(text).toContain("USAGE");
    expect(text).toContain("QUICK EXAMPLES");
    expect(text).toContain("miku-grep TODO .");
    expect(text).toContain("WHEN TO USE");
    expect(text).toContain("ARGUMENT OPTIONS");
    expect(text).toContain("ARGUMENT EXAMPLES");
    expect(text).toContain("JSON EXAMPLES");
    expect(text).toContain("MINIMAL REQUEST");
    expect(text).toContain("REQUEST FIELDS");
    expect(text).toContain("RESULT SHAPE");
    expect(text).toContain("FULL STDIN / STDOUT EXAMPLE");
    expect(text).toContain("Possible successful output");
    expect(text).toContain("Possible validation error output");
    expect(text).toContain("COMMON DIAGNOSTIC CODES");
    expect(text).toContain('"version": 1');
    expect(text).toContain("search.targets");
    expect(text).toContain("output.mode");
    expect(text).toContain("encoding.rules");
  });

  test("main returns exit 0 and stdout help for --help without reading stdin", async () => {
    const stdout = writableCapture();
    const stderr = writableCapture();
    const code = await main(["node", "miku-grep", "--help"], Readable.from([]), stdout.stream, stderr.stream);

    expect(code).toBe(0);
    expect(stderr.output()).toBe("");
    expect(stdout.output()).toContain("miku-grep - local-first grep CLI");
    expect(stdout.output()).toContain("QUICK EXAMPLES");
    expect(stdout.output()).toContain("MINIMAL REQUEST");
  });

  test("main returns text output for args-first search by default", async () => {
    const root = await fixture();
    const stdout = writableCapture();
    const stderr = writableCapture();
    const code = await main(["node", "miku-grep", "RepositoryMap", root], Readable.from([]), stdout.stream, stderr.stream);

    expect(code).toBe(0);
    expect(stderr.output()).toBe("");
    expect(stdout.output()).toContain("matches:");
    expect(stdout.output()).toContain("README.md");
    expect(() => JSON.parse(stdout.output())).toThrow();
  });

  test("main returns JSON output for args-first search with --format json", async () => {
    const root = await fixture();
    const stdout = writableCapture();
    const stderr = writableCapture();
    const code = await main(["node", "miku-grep", "RepositoryMap", root, "--format", "json"], Readable.from([]), stdout.stream, stderr.stream);

    expect(code).toBe(0);
    expect(stderr.output()).toBe("");
    expect(JSON.parse(stdout.output())).toMatchObject({ version: 1, ok: true });
  });

  test("main prints matching file paths for args-first --files", async () => {
    const root = await fixture();
    const stdout = writableCapture();
    const stderr = writableCapture();
    const code = await main(["node", "miku-grep", "RepositoryMap", root, "--files"], Readable.from([]), stdout.stream, stderr.stream);

    expect(code).toBe(0);
    expect(stderr.output()).toBe("");
    expect(stdout.output().split("\n")).toEqual(expect.arrayContaining(["README.md", "src/RepositoryMap.java"]));
  });

  test("main treats QUERY --files as matching files in the current root", async () => {
    const stdout = writableCapture();
    const stderr = writableCapture();
    const code = await main(["node", "miku-grep", "RepositoryMap", "--files"], Readable.from([]), stdout.stream, stderr.stream);

    expect(code).toBe(0);
    expect(stderr.output()).toBe("");
    expect(stdout.output()).toContain("README.md");
  });

  test("main lists inventory for --files without query", async () => {
    const root = await fixture();
    const stdout = writableCapture();
    const stderr = writableCapture();
    const code = await main(["node", "miku-grep", "--files", root], Readable.from([]), stdout.stream, stderr.stream);

    expect(code).toBe(0);
    expect(stderr.output()).toBe("");
    expect(stdout.output().split("\n")).toEqual(expect.arrayContaining(["README.md", "src/RepositoryMap.java", "src/legacy.txt"]));
  });

  test("main returns exit 0 and stdout JSON for valid requests", async () => {
    const root = await fixture();
    const stdout = writableCapture();
    const stderr = writableCapture();
    const code = await main(
      ["node", "miku-grep"],
      stdinFromJson({
        version: 1,
        root,
        query: { type: "literal", text: "RepositoryMap" },
        search: { targets: ["filepath"] },
      }),
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
      stdinFromJson({ version: 1, root: ".", query: { type: "literal", text: "" } }),
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
    expect(stderr.output()).toContain("usage: miku-grep QUERY [ROOT]");
  });

  test("main rejects mutually exclusive args-first output modes", async () => {
    const root = await fixture();
    const stdout = writableCapture();
    const stderr = writableCapture();
    const code = await main(["node", "miku-grep", "RepositoryMap", root, "--agent", "--context", "2"], Readable.from([]), stdout.stream, stderr.stream);

    expect(code).toBe(2);
    expect(stdout.output()).toBe("");
    expect(stderr.output()).toContain("mutually exclusive");
  });

  test("main rejects mutually exclusive args-first query and target modes", async () => {
    const root = await fixture();
    const regexGlobStdout = writableCapture();
    const regexGlobStderr = writableCapture();
    const regexGlobCode = await main(["node", "miku-grep", "RepositoryMap", root, "--regex", "--glob"], Readable.from([]), regexGlobStdout.stream, regexGlobStderr.stream);

    expect(regexGlobCode).toBe(2);
    expect(regexGlobStdout.output()).toBe("");
    expect(regexGlobStderr.output()).toContain("--regex and --glob are mutually exclusive");

    const pathAllStdout = writableCapture();
    const pathAllStderr = writableCapture();
    const pathAllCode = await main(["node", "miku-grep", "RepositoryMap", root, "--path", "--all-targets"], Readable.from([]), pathAllStdout.stream, pathAllStderr.stream);

    expect(pathAllCode).toBe(2);
    expect(pathAllStdout.output()).toBe("");
    expect(pathAllStderr.output()).toContain("--path and --all-targets are mutually exclusive");
  });

  test("dist CLI process returns exit 0 with parseable stdout JSON", async () => {
    const root = await fixture();
    const result = spawnSync(process.execPath, ["dist/main.js"], {
      input: `${JSON.stringify({
        version: 1,
        root,
        query: { type: "literal", text: "RepositoryMap" },
        search: { targets: ["filepath"] },
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
