import { z } from "zod";

export const SessionType = {
  Regular: "regular",
  ChannelSlack: "channel_slack",
  ChannelTelegram: "channel_telegram",
  ScheduleCron: "schedule_cron",
} as const;

export type SessionType = (typeof SessionType)[keyof typeof SessionType];

export enum SessionMode {
  Chat = "chat",
  Terminal = "terminal",
}

export const sessionModeSchema = z.enum(SessionMode);

export interface SessionView {
  sessionId: string;
  agentId: string;
  type: SessionType;
  mode: SessionMode;
  createdAt: string;
  scheduleId?: string | null;
  title?: string | null;
  updatedAt?: string | null;
}

export type TerminalStrategy =
  | { kind: "new" }
  | { kind: "continue" }
  | { kind: "resume"; sessionId: string };

export type SessionResolution =
  | { kind: "ready"; sessionId: string; terminalPath: string }
  | { kind: "confirm-mode-switch"; sessionId: string; currentMode: SessionMode }
  | { kind: "no-terminal-session" }
  | { kind: "multiple-terminal-sessions"; sessionIds: string[] }
  | { kind: "session-not-found"; sessionId: string };

export interface SessionsService {
  list(agentId: string, includeChannel?: boolean): Promise<SessionView[]>;
  create(
    sessionId: string,
    agentId: string,
    mode: SessionMode,
    type?: SessionType,
    scheduleId?: string,
  ): Promise<void>;
  setMode(sessionId: string, agentId: string, mode: SessionMode): Promise<void>;
  delete(sessionId: string, agentId: string): Promise<void>;
  listByScheduleId(scheduleId: string): Promise<SessionView[]>;
  findByScheduleId(scheduleId: string): Promise<SessionView | null>;
  resetByScheduleId(scheduleId: string): Promise<void>;
  resolveTerminal(
    agentId: string,
    strategy: TerminalStrategy,
    opts?: { reset?: boolean; force?: boolean },
  ): Promise<SessionResolution>;
}
