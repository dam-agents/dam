/**
 * Prefix for per-import staging directories created under the agent's home
 * dir. The HTTP handler (`http.ts`) creates `mkdtemp(homeDir, STAGING_PREFIX)`
 * per request; the boot sweeper (`sweeper.ts`) reclaims stale ones from
 * earlier crashes by matching this prefix — keep the two in sync.
 */
export const STAGING_PREFIX = ".import-staging-";
