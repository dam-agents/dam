import type { z } from "zod/v4";

import type {
  backgroundWorkItemSchema,
  backgroundWorkReportSchema,
} from "./schemas.js";

export type BackgroundWorkItem = z.infer<typeof backgroundWorkItemSchema>;
export type BackgroundWorkReport = z.infer<typeof backgroundWorkReportSchema>;

/**
 * What the platform does with a report, stated once so a harness author can
 * decide whether reporting is worth it:
 *
 * While a session's reported set is non-empty the runtime will not close that
 * session, and it reports itself busy so the pod is not hibernated underneath
 * the work. Both stop the moment a later report comes back empty.
 *
 * Reporting is optional. A harness that never reports behaves exactly as before
 * — its sessions are reaped on idleness, and background work an agent leaves
 * behind dies with the session's subprocess if the harness supervises it.
 */
export interface BackgroundWorkReporterContract {
  /** `POST {PLATFORM_RUNTIME_URL}/api/sessions/{sessionId}/background-work` */
  readonly path: "/api/sessions/{sessionId}/background-work";
  readonly body: BackgroundWorkReport;
}
