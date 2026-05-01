export type ScheduleCreator = "user" | "agent";

export interface QuietWindow {
  /** "HH:MM" 24-hour, local to schedule timezone. */
  startTime: string;
  /** "HH:MM" 24-hour. If `endTime <= startTime`, the window crosses midnight. */
  endTime: string;
  /** Per-window toggle — lets users silence a window without deleting it. */
  enabled: boolean;
}

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
  instanceId: string;
  spec: ScheduleSpec;
  status?: ScheduleStatus;
}

export interface CreateCronScheduleInput {
  name: string;
  instanceId: string;
  cron: string;
  task: string;
  sessionMode?: "continuous" | "fresh";
  createdBy?: ScheduleCreator;
}

export interface CreateRRuleScheduleInput {
  name: string;
  instanceId: string;
  rrule: string;
  timezone: string;
  quietHours?: QuietWindow[];
  task: string;
  sessionMode?: "continuous" | "fresh";
}

export interface UpdateRRuleScheduleInput {
  id: string;
  name: string;
  rrule: string;
  timezone: string;
  quietHours: QuietWindow[];
  task: string;
  sessionMode?: "continuous" | "fresh";
}

export interface SchedulesService {
  list: (instanceId: string) => Promise<Schedule[]>;
  get: (id: string) => Promise<Schedule | null>;
  createCron: (input: CreateCronScheduleInput) => Promise<Schedule>;
  createRRule: (input: CreateRRuleScheduleInput) => Promise<Schedule>;
  updateRRule: (input: UpdateRRuleScheduleInput) => Promise<Schedule | null>;
  delete: (id: string) => Promise<void>;
  toggle: (id: string) => Promise<Schedule | null>;
}
