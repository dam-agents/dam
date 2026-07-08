import { z } from "zod";

export const SessionType = {
  Regular: "regular",
  ChannelSlack: "channel_slack",
  ChannelTelegram: "channel_telegram",
  ScheduleCron: "schedule_cron",
  ExperimentTrial: "experiment_trial",
} as const;

export type SessionType = (typeof SessionType)[keyof typeof SessionType];

export enum SessionMode {
  Chat = "chat",
  Terminal = "terminal",
}

export const sessionModeSchema = z.enum(SessionMode);

/**
 * Sessions are agent-owned: the UI and channel workers read, create,
 * and mutate them directly over ACP, decoding this view from `_meta.platform`.
 * The server has no session service — the one schedule-scoped mutation (reset)
 * lives on the schedules service.
 */
export interface SessionView {
  sessionId: string;
  agentId: string;
  type: SessionType;
  mode: SessionMode;
  createdAt: string;
  scheduleId?: string | null;
  experimentId?: string | null;
  title?: string | null;
  updatedAt?: string | null;
  /** Live turn state from `session/list` enrichment — true while a turn is in flight. */
  running?: boolean;
}
