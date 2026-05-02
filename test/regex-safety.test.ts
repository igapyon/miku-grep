import { describe, expect, test } from "vitest";
import { hasNestedQuantifiedGroup } from "../src/regex-safety.js";

describe("regex safety heuristics", () => {
  test.each([
    ["^(a+)+$", true],
    ["(.+)+", true],
    ["(a*)+", true],
    ["(a{1,3})*", true],
    ["^([a+])+$", false],
    ["\\(a+\\)+", false],
    ["Repository(Map)?", false],
  ])("detects nested quantified groups in %s", (pattern, expected) => {
    expect(hasNestedQuantifiedGroup(pattern)).toBe(expected);
  });
});
