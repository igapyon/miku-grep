export function hasNestedQuantifiedGroup(pattern: string): boolean {
  const stack: Array<{ hasQuantifier: boolean }> = [];
  let escaped = false;
  let inCharClass = false;

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index] ?? "";
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (inCharClass) {
      if (char === "]") inCharClass = false;
      continue;
    }
    if (char === "[") {
      inCharClass = true;
      continue;
    }
    if (char === "(") {
      stack.push({ hasQuantifier: false });
      continue;
    }
    if (char === ")") {
      const group = stack.pop();
      if (!group) continue;
      const next = pattern[index + 1] ?? "";
      const groupIsQuantified = next === "*" || next === "+" || next === "?" || next === "{";
      if (group.hasQuantifier && groupIsQuantified) return true;
      if (group.hasQuantifier && stack.length > 0) stack[stack.length - 1]!.hasQuantifier = true;
      continue;
    }
    if ((char === "*" || char === "+" || char === "?" || char === "{") && stack.length > 0) {
      stack[stack.length - 1]!.hasQuantifier = true;
    }
  }

  return false;
}
