import type { PlatformAccess } from "api-server-api";

// UNIT_BOUNDARY_DESCRIPTION: the Platform Access of a grant whose stored value cannot be read. It is on the scale and names no permission, so its Agent is refused everything and never falls back to the Connection's own key, which reaches far more.
export const NO_PLATFORM_ACCESS: PlatformAccess = [];

// UNIT_BOUNDARY_DESCRIPTION: whether a Platform Access lets its Agent read itself, the one thing the first step of the scale allows. Any entry does: each one names every area and every action with reach `own`, and `own` holds the Agent itself.
export function readsItself(access: PlatformAccess | null): boolean {
  return access !== null && access.length > 0;
}
