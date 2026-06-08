/** Prefix for the import module's per-request staging dirs under the agent home;
 *  `import` creates them, `files` hides them, the sweeper reclaims stale ones. */
export const IMPORT_STAGING_PREFIX = ".import-staging-";
