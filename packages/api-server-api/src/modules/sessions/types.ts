import { z } from "zod";

export const SessionType = {
  Regular: "regular",
  ChannelSlack: "channel_slack",
  ChannelTelegram: "channel_telegram",
  ScheduleCron: "schedule_cron",
  ExperimentExecute: "experiment_execute",
} as const;

export type SessionType = (typeof SessionType)[keyof typeof SessionType];

export enum SessionMode {
  Chat = "chat",
  Terminal = "terminal",
}

export const sessionModeSchema = z.enum(SessionMode);

export const AMBIENT_THREAD_KEY_PREFIX = "ambient:";

export function ambientThreadKey(channelId: string): string {
  return `${AMBIENT_THREAD_KEY_PREFIX}${channelId}`;
}

export function isAmbientThreadKey(
  threadKey: string | null | undefined,
): boolean {
  return !!threadKey && threadKey.startsWith(AMBIENT_THREAD_KEY_PREFIX);
}

export function slackThreadKey(channelId: string, threadTs: string): string {
  return `${channelId}:${threadTs}`;
}

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
  threadTs?: string | null;
  running?: boolean;
  seenAt?: string | null;
}

export const SESSION_CATEGORIES = [
  "chats",
  "experiments",
  "scheduled",
  "channels",
  "terminal",
] as const;

export type SessionCategory = (typeof SESSION_CATEGORIES)[number];

export function sessionCategoryOf(session: {
  mode: SessionMode;
  type: SessionType;
}): SessionCategory {
  if (session.mode === SessionMode.Terminal) return "terminal";
  if (
    session.type === SessionType.ChannelSlack ||
    session.type === SessionType.ChannelTelegram
  )
    return "channels";
  if (session.type === SessionType.ScheduleCron) return "scheduled";
  if (session.type === SessionType.ExperimentExecute) return "experiments";
  return "chats";
}
