export function newestAgent<T extends { createdAt?: string }>(
  agents: readonly T[],
): T | undefined {
  return agents.reduce<T | undefined>(
    (newest, a) =>
      !newest || (a.createdAt ?? "") > (newest.createdAt ?? "") ? a : newest,
    undefined,
  );
}
