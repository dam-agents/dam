/**
 * Public surface of the `auth` module. The narrow seam other modules in
 * this package consume. ADR-039's CLI carve-out re-opens `index.ts` per
 * module — only application-service interfaces and the error variants
 * their signatures reference leak. No factories, no concrete services,
 * no domain values, no infrastructure adapters.
 *
 * Future authenticated verbs (`shell`, `import`, …) import
 * `TokenProvider` from here. Diagnostics live in `dam auth status`
 * output, not in the programmatic surface.
 */
export type { TokenProvider } from "./services/token-provider.js";
export type {
  TokenProviderError,
  NotLoggedInError,
  SessionExpiredError,
  RefreshFailedError,
  RefreshTransientError,
} from "./domain/errors.js";
export { createBrowserOpener } from "./infrastructure/browser-opener.js";
export type { BrowserOpener } from "./infrastructure/browser-opener.js";
