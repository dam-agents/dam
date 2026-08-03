/** Postgres unique-constraint violation (SQLSTATE 23505). Walks the `.cause`
 *  chain so it matches whether the driver error is raw (postgres-js) or wrapped
 *  in a DrizzleQueryError (node-postgres); pass `constraintName` to match a
 *  specific index. */
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
