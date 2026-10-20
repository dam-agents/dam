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

// UNIT_BOUNDARY_DESCRIPTION: says why the chat's renderer would reject a regex check's pattern, by the rules of @a2ui/web_core's isSafeRegex (src/v0_9/basic_catalog/functions/safe_regex.js) and validateRegex (src/common/basic_functions.js): it compiles with new RegExp(pattern) and no flags, has at most 256 characters, and redos-detector finds both the pattern and ^(?:pattern)$ safe; keep it in step with the @a2ui/web_core version packages/ui uses.
export function regexPatternProblem(pattern: string): string | undefined {
  if (pattern.length === 0) return undefined;
  if (pattern.length > MAX_PATTERN_LENGTH)
    return `it is longer than ${MAX_PATTERN_LENGTH} characters`;
  try {
    new RegExp(pattern);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return isSafe(pattern) ? undefined : UNSAFE;
}
