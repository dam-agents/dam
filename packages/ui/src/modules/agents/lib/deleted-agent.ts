export function vanishedAgentIds(
  previous: readonly { id: string }[] | undefined,
  next: readonly { id: string }[],
): string[] {
  const kept = new Set(next.map((a) => a.id));
  return (previous ?? []).filter((a) => !kept.has(a.id)).map((a) => a.id);
}

export function agentFallback(
  inaccessible: boolean,
  deleted: boolean,
): "public" | "home" | null {
  if (!inaccessible) return null;
  return deleted ? "home" : "public";
}
