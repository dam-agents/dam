import type { z } from "zod/v4";

import type {
  backgroundWorkItemSchema,
  backgroundWorkReportSchema,
} from "./schemas.js";

export type BackgroundWorkItem = z.infer<typeof backgroundWorkItemSchema>;
export type BackgroundWorkReport = z.infer<typeof backgroundWorkReportSchema>;

export interface BackgroundWorkReporterContract {
  readonly path: "/api/sessions/{sessionId}/background-work";
  readonly body: BackgroundWorkReport;
}
