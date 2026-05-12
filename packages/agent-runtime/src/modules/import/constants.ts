/**
 * Prefix for per-import staging directories created under the agent's home
 * dir. Shared by the extract pipeline (which creates them) and the boot
 * sweeper (which reclaims stale ones after a crash) — keep in sync.
 */
export const STAGING_PREFIX = ".import-staging-";
