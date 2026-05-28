import type { z } from "zod";
import type {
  quietWindowSchema,
  scheduleCreateCronInputSchema,
  scheduleCreateRRuleInputSchema,
  scheduleUpdateRRuleInputSchema,
} from "./schemas.js";

export type ScheduleCreator = "user" | "agent";

export type QuietWindow = z.infer<typeof quietWindowSchema>;

export interface ScheduleSpecCron {
  version: string;
  type: "cron";
  cron: string;
  task?: string;
  enabled: boolean;
  sessionMode?: "continuous" | "fresh";
  createdBy: ScheduleCreator;
}

export interface ScheduleSpecRRule {
  version: string;
  type: "rrule";
  /** RFC 5545 RRULE body — e.g. "FREQ=WEEKLY;BYDAY=MO,WE;BYHOUR=7;BYMINUTE=30" */
  rrule: string;
  /** IANA timezone, e.g. "Europe/Prague". Applied to both the RRULE and quiet hours. */
  timezone: string;
  quietHours?: QuietWindow[];
  task?: string;
  enabled: boolean;
  sessionMode?: "continuous" | "fresh";
  createdBy: ScheduleCreator;
}

export type ScheduleSpec = ScheduleSpecCron | ScheduleSpecRRule;

export interface ScheduleStatus {
  lastRun?: string;
  nextRun?: string;
  /** One of: "success", "skipped: quiet hours", or an error message. */
  lastResult?: string;
}

export interface Schedule {
  id: string;
  name: string;
  agentId: string;
  spec: ScheduleSpec;
  status?: ScheduleStatus;
}

export type ScheduleCreateCronInput = z.infer<
  typeof scheduleCreateCronInputSchema
>;
export type ScheduleCreateRRuleInput = z.infer<
  typeof scheduleCreateRRuleInputSchema
>;
export type ScheduleUpdateRRuleInput = z.infer<
  typeof scheduleUpdateRRuleInputSchema
>;

export interface SchedulesService {
  list: (agentId: string) => Promise<Schedule[]>;
  get: (id: string) => Promise<Schedule | null>;
  /** `createdBy` defaults to "user" when omitted; the MCP endpoint passes
   *  "agent" so schedules created from inside an agent's session are
   *  labeled accordingly. */
  createCron: (
    input: ScheduleCreateCronInput,
    createdBy?: ScheduleCreator,
  ) => Promise<Schedule>;
  createRRule: (input: ScheduleCreateRRuleInput) => Promise<Schedule>;
  updateRRule: (input: ScheduleUpdateRRuleInput) => Promise<Schedule | null>;
  delete: (id: string) => Promise<void>;
  toggle: (id: string) => Promise<Schedule | null>;
}
