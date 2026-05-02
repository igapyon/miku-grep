export function matchesAny(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => globMatch(value, pattern));
}

export function globMatch(value: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]");
  return new RegExp(`^${escaped}$`).test(value);
}

export function pathGlobMatch(value: string, pattern: string): boolean {
  const escaped = pattern
    .split("/")
    .map((part) => {
      if (part === "**") return ".*";
      return part.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]");
    })
    .join("/");
  return new RegExp(`^${escaped}$`).test(value);
}
