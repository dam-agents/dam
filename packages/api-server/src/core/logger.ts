/** The api-server's structured logger.
 *
 *  Backed by Pino — a single process-wide instance configured once at startup
 *  (index.ts), imported via `getLogger()` so it need not be threaded through
 *  every service factory (the same singleton shape as `emit()`/`events$()` in
 *  `events.ts`). Pino emits one JSON object per line on STDOUT; visibility is
 *  governed by the configured level (the common `error|warn|info|debug`),
 *  with no bespoke per-feature toggles. It is the substrate the security audit
 *  trail (`security-log.ts`) is built on, but it is a general logger — any
 *  component may use it.
 *
 *  In Kubernetes stdout and stderr are merged into one pod log, so consumers
 *  discriminate on fields (the audit trail's `category`), not on stream. */

import pino, { type Logger, type LoggerOptions } from "pino";

export type { Logger };
export type LogLevel = "error" | "warn" | "info" | "debug";

function options(
  level: LogLevel,
  base?: Record<string, unknown>,
): LoggerOptions {
  return {
    level,
    // String level labels and an ISO `time` — readable, parseable, and
    // independent of Pino's numeric defaults.
    formatters: { level: (label: string) => ({ level: label }) },
    timestamp: pino.stdTimeFunctions.isoTime,
    // Drop pid/hostname noise — the log pipeline annotates pod identity.
    // A provided base (e.g. build identity) stamps every line instead.
    base,
    // Defense-in-depth: even though call sites must never pass secret values,
    // censor a few well-known credential keys (top-level and one nesting deep)
    // so a careless field can't leak a token onto the forensic stream.
    redact: {
      paths: [
        "token",
        "*.token",
        "authorization",
        "*.authorization",
        "password",
        "*.password",
        "secret",
        "*.secret",
        "refreshToken",
        "*.refreshToken",
      ],
      censor: "[REDACTED]",
    },
  };
}

let instance: Logger = pino(options("info"));

/** Configure the process-wide logger. Call once at startup. `write` swaps the
 *  destination (tests capture lines); otherwise output goes to STDOUT. */
export function configureLogger(opts: {
  level?: LogLevel;
  write?: (line: string) => void;
  base?: Record<string, unknown>;
}): void {
  const level = opts.level ?? (instance.level as LogLevel);
  instance = opts.write
    ? pino(options(level, opts.base), { write: opts.write })
    : pino(options(level, opts.base));
}

/** The current Pino instance. Read at call time so reconfiguration applies. */
export function getLogger(): Logger {
  return instance;
}
