/**
 * Read-merge-write for an Agent's `allowedUserEmails`, the full-replace ACL field
 * `agents.update` exposes. Unions `add`, subtracts `remove`, dedupes, and keeps a
 * stable order (existing entries first, then new additions in the order given).
 * Pure — no I/O — so a future `dam agent update` can reuse the same merge.
 *
 * Matching is case-insensitive: Keycloak resolves email → user case-insensitively
 * and the stored list carries that canonical casing, so a `remove` typed in a
 * different case must still subtract (otherwise a `disallow` silently no-ops), and
 * an `add` that differs only in case must not duplicate. The original casing of the
 * surviving entry is preserved in the output.
 */
export function mergeAllowedUserEmails(
  current: readonly string[],
  opts: { add?: readonly string[]; remove?: readonly string[] },
): string[] {
  const removeSet = new Set((opts.remove ?? []).map((e) => e.toLowerCase()));
  const seen = new Set<string>();
  const result: string[] = [];
  for (const email of [...current, ...(opts.add ?? [])]) {
    const key = email.toLowerCase();
    if (removeSet.has(key) || seen.has(key)) continue;
    seen.add(key);
    result.push(email);
  }
  return result;
}
