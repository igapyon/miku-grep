import path from "node:path";
import { describe, expect, test } from "vitest";
import { isPathInsideOrSame } from "../src/path-security.js";

describe("path security helpers", () => {
  test("accepts paths inside or equal to the base path", () => {
    const base = path.resolve("/tmp/miku-grep-base");

    expect(isPathInsideOrSame(base, base)).toBe(true);
    expect(isPathInsideOrSame(path.join(base, "src", "file.txt"), base)).toBe(true);
  });

  test("rejects sibling paths with the same prefix", () => {
    const base = path.resolve("/tmp/miku-grep-base");
    const sibling = path.resolve("/tmp/miku-grep-base2/file.txt");

    expect(isPathInsideOrSame(sibling, base)).toBe(false);
  });
});
