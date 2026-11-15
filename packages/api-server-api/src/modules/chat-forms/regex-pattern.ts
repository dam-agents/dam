import { isSafePattern } from "redos-detector";

const MAX_PATTERN_LENGTH = 256;
const UNSAFE =
  "it risks catastrophic backtracking (for example a nested quantifier such as (a+)+)";

function isSafe(pattern: string): boolean {
  try {
    return (
      isSafePattern(pattern).safe && isSafePattern(`^(?:${pattern})$`).safe
    );
  } catch {
    return false;
  }
}

function disallowedConstruct(pattern: string): string | undefined {
  let inClass = false;
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1] ?? "";
    if (char === "\\") {
      if (/[1-9]/.test(next) || (next === "k" && pattern[index + 2] === "<"))
        return "a backreference";
      if (next === "p" || next === "P") return "a \\p{...} property escape";
      if (next === "c") return "a \\cX control escape";
      if (next === "0" && /[0-9]/.test(pattern[index + 2] ?? ""))
        return "a legacy octal escape";
      index += 1;
      continue;
    }
    if (inClass) {
      if (char === "]") inClass = false;
      continue;
    }
    if (char === "[") inClass = true;
    else if (char === "(" && next === "?") {
      const rest = pattern.slice(index + 2);
      if (rest.startsWith("<=") || rest.startsWith("<!")) return "a lookbehind";
      if (rest.startsWith("<")) return "a named group";
      if (/^[a-zA-Z-]+[:)]/.test(rest)) return "an inline flag";
    }
  }
  return undefined;
}

// UNIT_BOUNDARY_DESCRIPTION: says why a regex check's pattern fails, by the A2UI 1.0 regex dialect (Unicode mode, no backreferences, lookbehind, named groups, property or control escapes, legacy octal or inline flags) and by the rules of @a2ui/web_core's isSafeRegex (src/v0_9/basic_catalog/functions/safe_regex.js) and validateRegex (src/common/basic_functions.js): it compiles with new RegExp(pattern) and no flags, has at most 256 characters, and redos-detector finds both the pattern and ^(?:pattern)$ safe; keep it in step with the @a2ui/web_core version packages/ui uses.
export function regexPatternProblem(pattern: string): string | undefined {
  if (pattern.length === 0) return undefined;
  if (pattern.length > MAX_PATTERN_LENGTH)
    return `it is longer than ${MAX_PATTERN_LENGTH} characters`;
  try {
    new RegExp(pattern);
    new RegExp(pattern, "u");
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  const construct = disallowedConstruct(pattern);
  if (construct)
    return `it uses ${construct}, which the A2UI regex dialect does not allow`;
  return isSafe(pattern) ? undefined : UNSAFE;
}
