export interface OwnerDirectoryPort {
  isActive(sub: string): Promise<boolean>;
}

const DEFAULT_TTL_MS = 60_000;

export function createOwnerActiveProbe(deps: {
  directory: OwnerDirectoryPort;
  ttlMs?: number;
  now?: () => number;
}): (sub: string) => Promise<boolean> {
  const ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
  const now = deps.now ?? Date.now;
  const activeUntil = new Map<string, number>();

  return async function verifyOwnerActive(sub) {
    const hit = activeUntil.get(sub);
    if (hit !== undefined && hit > now()) return true;
    try {
      const active = await deps.directory.isActive(sub);
      if (active) {
        if (activeUntil.size >= 10_000) activeUntil.clear();
        activeUntil.set(sub, now() + ttlMs);
      }
      return active;
    } catch {
      return true;
    }
  };
}
