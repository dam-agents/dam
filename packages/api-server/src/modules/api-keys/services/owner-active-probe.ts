import { boundedSet } from "../../../core/bounded-map.js";

export interface OwnerDirectoryPort {
  isActive(sub: string): Promise<boolean>;
}

/* UNIT_BOUNDARY_DESCRIPTION: whether the identity provider says a key's owner may still act. `unknown` is the directory failing to answer, which is never `active`: an API key outlives the sign-in that made it, so a probe that failed open would keep a disabled person's key working for as long as the directory is down. */
export type OwnerActiveState = "active" | "inactive" | "unknown";

const ACTIVE_TTL_MS = 60_000;

export function createOwnerActiveProbe(deps: {
  directory: OwnerDirectoryPort;
}): (sub: string) => Promise<OwnerActiveState> {
  const activeUntil = new Map<string, number>();

  return async function verifyOwnerActive(sub): Promise<OwnerActiveState> {
    const hit = activeUntil.get(sub);
    if (hit !== undefined && hit > Date.now()) return "active";
    try {
      const active = await deps.directory.isActive(sub);
      if (!active) return "inactive";
      boundedSet(activeUntil, sub, Date.now() + ACTIVE_TTL_MS);
      return "active";
    } catch {
      return "unknown";
    }
  };
}
