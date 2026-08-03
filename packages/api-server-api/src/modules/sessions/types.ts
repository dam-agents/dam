import { z } from "zod";

export const SessionType = {
  Regular: "regular",
  ChannelSlack: "channel_slack",
  ChannelTelegram: "channel_telegram",
  ScheduleCron: "schedule_cron",
  /** The turn that launches an experiment script (Execute on a draft). */
  ExperimentExecute: "experiment_execute",
} as const;

export type SessionType = (typeof SessionType)[keyof typeof SessionType];

export enum SessionMode {
  Chat = "chat",
  Terminal = "terminal",
}

export const sessionModeSchema = z.enum(SessionMode);

/**
 * Reserved prefix for a channel's rolling "ambient" session key. Top-level
 * channel chatter the agent reads along with shares one session per channel
 * (`ambient:<channelId>`), while thread replies keep their per-thread keys.
 * Slack `thread_ts` values are numeric, so this prefix can't collide with a
 * real thread key. Defined here so the channel worker (writer) and the UI
 * (reader) agree on the format in one place.
 */
export const AMBIENT_THREAD_KEY_PREFIX = "ambient:";

/** Build the rolling ambient session key for a channel. */
export function ambientThreadKey(channelId: string): string {
  return `${AMBIENT_THREAD_KEY_PREFIX}${channelId}`;
}

/** True when a session's thread key is a channel's rolling ambient reader. */
export function isAmbientThreadKey(
  threadKey: string | null | undefined,
): boolean {
  return !!threadKey && threadKey.startsWith(AMBIENT_THREAD_KEY_PREFIX);
}

/**
 * Session key for a Slack thread, qualified by its conversation. A Slack
 * `thread_ts` is only unique within a conversation, and one agent may be bound
 * to several at once (#3086) — an unqualified key would let a thread in one
 * channel resume a same-ts thread's session in another. A conversation id never
 * spells `ambient`, so this can't collide with {@link ambientThreadKey}.
 */
export function slackThreadKey(channelId: string, threadTs: string): string {
  return `${channelId}:${threadTs}`;
}

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
  /**
   * Channel session's thread key from `_meta.platform.threadTs`: the rolling
   * ambient key (`ambient:<channelId>`) for a channel's reads-along session, or
   * the Slack `thread_ts` / Telegram conversation id for a thread session.
   * Absent on non-channel sessions. Lets the UI tell an ambient reader from the
   * threads it spins off — see {@link isAmbientThreadKey}.
   */
  threadTs?: string | null;
  /** Live turn state from `session/list` enrichment — true while a turn is in flight. */
  running?: boolean;
  /** When a viewer last saw the session; unread = updatedAt newer than this. */
  seenAt?: string | null;
}
