/**
 * Public surface of the `cli` module — the narrow interface other modules
 * in this package consume. ADR-039 dropped the events-only inter-module
 * rule for the CLI package; the spec re-opens `index.ts` per module as
 * the seam for application-service interfaces only. No factories, no
 * concrete types, no domain values, no infrastructure adapters leak.
 *
 * The auth module (issue 2+) imports `CompatService` from here for its
 * login pre-flight check.
 */
export type { CompatService } from "./services/compat-service.js";
export type { ConfigService } from "./services/config-service.js";
export type {
  FileWriteError,
  InvalidValueError,
  MalformedConfigError,
  MissingConfigError,
  ProbeError,
} from "./domain/errors.js";
export type { Config, ConfigKey } from "./domain/config.js";
