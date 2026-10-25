import type { z } from "zod";
import type {
  precheckVerdictSchema,
  quietWindowSchema,
  scheduleCreateCronInputSchema,
  scheduleCreateOnceInputSchema,
  scheduleCreateRRuleInputSchema,
  scheduleUpdateCronInputSchema,
  scheduleUpdateOnceInputSchema,
  scheduleUpdateRRuleInputSchema,
} from "./schemas.js";

export type ScheduleCreator = "user" | "agent";

export type QuietWindow = z.infer<typeof quietWindowSchema>;

export interface ScheduleSpecCron {
  version: string;
  type: "cron";
  cron: string;
  task?: string;
  precheck?: string;
  harness?: string;
  model?: string;
  settings?: Record<string, string>;
  /* UNIT_BOUNDARY_DESCRIPTION: a schedule stores the profile it runs on, or its
   * own values; the pair is resolved at read so every fire and every view sees
   * values. */
  profile?: string;
  migrationNote?: string;
  sessionTitle?: string;
  enabled: boolean;
  sessionMode?: "continuous" | "fresh";
  createdBy: ScheduleCreator;
}

export interface ScheduleSpecRRule {
  version: string;
  type: "rrule";
  rrule: string;
  timezone: string;
  quietHours?: QuietWindow[];
  task?: string;
  precheck?: string;
  harness?: string;
  model?: string;
  settings?: Record<string, string>;
  /* UNIT_BOUNDARY_DESCRIPTION: a schedule stores the profile it runs on, or its
   * own values; the pair is resolved at read so every fire and every view sees
   * values. */
  profile?: string;
  migrationNote?: string;
  sessionTitle?: string;
  enabled: boolean;
  sessionMode?: "continuous" | "fresh";
  createdBy: ScheduleCreator;
}

export type OnceSessionChoice = "fresh" | "continue" | "report";

export interface ScheduleOnceOrigin {
  sessionRef: string;
  mode: Exclude<OnceSessionChoice, "fresh">;
}

export interface ScheduleSpecOnce {
  version: string;
  type: "once";
  at: string;
  timezone: string;
  origin?: ScheduleOnceOrigin;
  harness?: string;
  model?: string;
  settings?: Record<string, string>;
  /* UNIT_BOUNDARY_DESCRIPTION: a schedule stores the profile it runs on, or its
   * own values; the pair is resolved at read so every fire and every view sees
   * values. */
  profile?: string;
  migrationNote?: string;
  sessionTitle?: string;
  task?: string;
  precheck?: undefined;
  sessionMode?: undefined;
  enabled: boolean;
  createdBy: ScheduleCreator;
}

export type ScheduleSpec =
  ScheduleSpecCron | ScheduleSpecRRule | ScheduleSpecOnce;

export interface ScheduleStatus {
  lastRun?: string;
  nextRun?: string;
  lastResult?: string;
  stopReason?: string;
  lastDeclinedAt?: string;
  declinedCount?: number;
  lastPrecheckError?: string;
  precheckFailedCount?: number;
}

export type PrecheckVerdict = z.infer<typeof precheckVerdictSchema>;

export interface Schedule {
  id: string;
  name: string;
  agentId: string;
  spec: ScheduleSpec;
  /** UNIT_BOUNDARY_DESCRIPTION: why the profile this schedule names cannot run on its agent, so a fire refuses with that reason instead of running another model. */
  profileIssue?: string;
  status?: ScheduleStatus;
}

export type ScheduleCreateCronInput = z.infer<
  typeof scheduleCreateCronInputSchema
>;
export type ScheduleUpdateCronInput = z.infer<
  typeof scheduleUpdateCronInputSchema
>;
export type ScheduleCreateRRuleInput = z.infer<
  typeof scheduleCreateRRuleInputSchema
>;
export type ScheduleUpdateRRuleInput = z.infer<
  typeof scheduleUpdateRRuleInputSchema
>;
export type ScheduleCreateOnceInput = z.infer<
  typeof scheduleCreateOnceInputSchema
>;
export type ScheduleUpdateOnceInput = z.infer<
  typeof scheduleUpdateOnceInputSchema
>;

export interface SchedulesService {
  list: (agentId: string) => Promise<Schedule[]>;
  listForOwner: (limit?: number) => Promise<Schedule[]>;
  get: (id: string) => Promise<Schedule | null>;
  createCron: (
    input: ScheduleCreateCronInput,
    createdBy?: ScheduleCreator,
  ) => Promise<Schedule>;
  createRRule: (
    input: ScheduleCreateRRuleInput,
    createdBy?: ScheduleCreator,
  ) => Promise<Schedule>;
  updateCron: (input: ScheduleUpdateCronInput) => Promise<Schedule | null>;
  updateRRule: (input: ScheduleUpdateRRuleInput) => Promise<Schedule | null>;
  createOnce: (
    input: ScheduleCreateOnceInput,
    createdBy?: ScheduleCreator,
    origin?: ScheduleOnceOrigin,
  ) => Promise<Schedule>;
  updateOnce: (input: ScheduleUpdateOnceInput) => Promise<Schedule | null>;
  delete: (id: string) => Promise<void>;
  toggle: (id: string, enabled?: boolean) => Promise<Schedule | null>;
  clearSessionChoices: (id: string) => Promise<Schedule | null>;
  resetSession: (id: string) => Promise<void>;
  runNow: (id: string) => Promise<void>;
}
