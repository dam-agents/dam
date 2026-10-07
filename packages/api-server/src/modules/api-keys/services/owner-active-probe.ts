import { boundedSet } from "../../../core/bounded-map.js";

export interface OwnerDirectoryPort {
  isActive(sub: string): Promise<boolean>;
}

const ACTIVE_TTL_MS = 60_000;

export function createOwnerActiveProbe(deps: {
  directory: OwnerDirectoryPort;
}): (sub: string) => Promise<boolean> {
  const activeUntil = new Map<string, number>();

  return async function verifyOwnerActive(sub) {
    const hit = activeUntil.get(sub);
    if (hit !== undefined && hit > Date.now()) return true;
    try {
      const active = await deps.directory.isActive(sub);
      if (active) {
        boundedSet(activeUntil, sub, Date.now() + ACTIVE_TTL_MS);
      }
      return active;
    } catch {
      return true;
    }
  };
}
