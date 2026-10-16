import type { ApprovalView } from "api-server-api";

export function approvalGroupKey(approval: ApprovalView): string {
  const p = approval.payload;
  if (p.kind !== "ext_authz") return approval.id;
  return JSON.stringify([
    approval.agentId,
    approval.status,
    p.host.toLowerCase(),
    p.port ?? null,
    p.method,
    p.path,
  ]);
}

export function groupBy<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
): T[][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.values()];
}
