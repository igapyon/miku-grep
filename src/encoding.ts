import iconv from "iconv-lite";
import { globMatch, pathGlobMatch } from "./glob.js";
import type { EffectiveRequest, EncodingRuleResult, SupportedEncoding } from "./public-types.js";

export function selectEncoding(
  config: EffectiveRequest["encoding"],
  relativePath: string,
  basename: string,
): { encoding: SupportedEncoding; encodingRule: EncodingRuleResult } {
  for (const rule of config.rules) {
    if (rule.pathPattern && pathGlobMatch(relativePath, rule.pathPattern)) {
      return { encoding: rule.encoding, encodingRule: { type: "pathPattern", pattern: rule.pathPattern } };
    }
  }
  for (const rule of config.rules) {
    if (rule.fileNamePattern && globMatch(basename, rule.fileNamePattern)) {
      return { encoding: rule.encoding, encodingRule: { type: "fileNamePattern", pattern: rule.fileNamePattern } };
    }
  }
  return { encoding: config.default, encodingRule: { type: "default" } };
}

export function decode(bytes: Uint8Array, encoding: SupportedEncoding): string {
  if (encoding === "utf-8") return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return iconv.decode(Buffer.from(bytes), "shift_jis");
}
