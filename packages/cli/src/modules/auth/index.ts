/**
 * Public surface of the `auth` module. The narrow seam other modules in
 * this package consume. ADR-039's CLI carve-out re-opens `index.ts` per
 * module — only application-service interfaces and the error variants
 * their signatures reference leak.
 *
 * Empty for issue 2. Issue 5 lands `TokenProvider` here; that is the only
 * service this module is expected to export. Diagnostics live in the
 * `dam auth status` command output, not in the programmatic surface.
 */
export {};
