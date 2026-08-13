export function isUniqueViolation(
  err: unknown,
  constraintName?: string,
): boolean {
  for (
    let cur: unknown = err, depth = 0;
    cur !== null && typeof cur === "object" && depth < 10;
    cur = (cur as { cause?: unknown }).cause, depth++
  ) {
    const obj = cur as { code?: unknown; constraint_name?: unknown };
    if (
      obj.code === "23505" &&
      (constraintName === undefined || obj.constraint_name === constraintName)
    ) {
      return true;
    }
  }
  return false;
}
