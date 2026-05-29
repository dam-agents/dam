import type { Subscription } from "rxjs";
import { startAuditLogSaga } from "./sagas/audit-log.js";

export interface AuditModule {
  /** Subscribes the domain bus and starts emitting audit lines. */
  start(): void;
  /** Unsubscribes (test/teardown). */
  stop(): void;
}

/**
 * Security audit-trail module. A bus-driven sink (mirrors the usage module
 * shape) with no domain operations of its own: it subscribes the event bus
 * and writes forensic audit lines via the shared logger. It needs no deps —
 * the logger and the event bus are both process-wide singletons.
 *
 * The trail is governed by the configured log level (no separate toggle); the
 * saga always subscribes, and whether a line is emitted is the logger's call.
 */
export function composeAuditModule(): AuditModule {
  let sub: Subscription | null = null;
  return {
    start() {
      sub ??= startAuditLogSaga();
    },
    stop() {
      sub?.unsubscribe();
      sub = null;
    },
  };
}
