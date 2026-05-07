export const SessionType = {
  Regular: "regular",
  ChannelSlack: "channel_slack",
  ChannelTelegram: "channel_telegram",
  ScheduleCron: "schedule_cron",
} as const;

export type SessionType = (typeof SessionType)[keyof typeof SessionType];

export const SessionMode = {
  Chat: "chat",
  Terminal: "terminal",
} as const;

export type SessionMode = (typeof SessionMode)[keyof typeof SessionMode];

export interface SessionView {
  sessionId: string;
  instanceId: string;
  type: SessionType;
  mode: SessionMode;
  createdAt: string;
  scheduleId?: string | null;
  title?: string | null;
  updatedAt?: string | null;
}

export interface SessionsService {
  list(instanceId: string, includeChannel?: boolean): Promise<SessionView[]>;
  create(sessionId: string, instanceId: string, mode: SessionMode, type?: SessionType, scheduleId?: string): Promise<void>;
  setMode(sessionId: string, instanceId: string, mode: SessionMode): Promise<void>;
  delete(sessionId: string, instanceId: string): Promise<void>;
  listByScheduleId(scheduleId: string): Promise<SessionView[]>;
  findByScheduleId(scheduleId: string): Promise<SessionView | null>;
  resetByScheduleId(scheduleId: string): Promise<void>;
}
