import type { z } from "zod";

import type { securityCheckReportInputSchema } from "./schemas.js";

export type SecurityCheckReportInput = z.infer<
  typeof securityCheckReportInputSchema
>;

/**
 * UNIT_BOUNDARY_DESCRIPTION: what the assistant last reported about its
 * owner's setup: the Agent that runs the check, the Schedule the platform
 * made for it, a short title for each problem it found, and when it said so.
 * A report with no problem says the setup is fine, and takes the alert away.
 */
export interface SecurityCheckReport {
  agentId: string;
  scheduleId: string | null;
  problems: string[];
  reportedAt: string;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the alert the owner gets when the assistant's
 * security check found something. The Session is the check's latest one,
 * where the assistant described each problem and offers to fix it; it is null
 * when that Session is no longer listed. The id names one report, so a
 * dismissal hides this report only and a later one is told again.
 */
export interface SecurityCheckNotice {
  id: string;
  agentId: string;
  sessionId: string | null;
  problems: string[];
  reportedAt: string;
}

export interface SecurityChecksService {
  /**
   * UNIT_BOUNDARY_DESCRIPTION: gives this person the weekly check when they
   * turn the feature on: an ordinary Schedule on their assistant. A Schedule
   * they deleted is made again, since the switch is the ask.
   */
  enable(): Promise<void>;
  /**
   * UNIT_BOUNDARY_DESCRIPTION: takes the check away when they turn the
   * feature off: the Schedule the platform made, and the last report with it.
   */
  disable(): Promise<void>;
  /**
   * UNIT_BOUNDARY_DESCRIPTION: records what a check found, replacing the
   * report before it. An update says what is left of the same check after a
   * fix, so it keeps that report's time and with it the owner's dismissal.
   * Null when the caller has no check to report on.
   */
  report(input: SecurityCheckReportInput): Promise<SecurityCheckReport | null>;
}
