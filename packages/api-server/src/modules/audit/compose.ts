import type { Subscription } from "rxjs";
import { startAuditLogSaga } from "./sagas/audit-log.js";

export interface AuditModule {
  start(): void;
  stop(): void;
}

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
