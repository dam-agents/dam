import { type DefaultKind, SessionType } from "api-server-api";
import { match } from "ts-pattern";

/**
 * UNIT_BOUNDARY_DESCRIPTION: which of the agent's three defaults a session
 * starts from and saves with "Set as default": chats and terminal runs use
 * the chat default, Slack and Telegram threads the channel default, schedule
 * runs the scheduled default. A sub-agent session takes its choices from the
 * session that spawned it, so it has no default of its own.
 */
export function defaultKindOf(
  type: SessionType | undefined,
): DefaultKind | null {
  return match(type)
    .with(
      SessionType.Regular,
      SessionType.CliRun,
      undefined,
      () => "chat" as const,
    )
    .with(
      SessionType.ChannelSlack,
      SessionType.ChannelTelegram,
      () => "channel" as const,
    )
    .with(
      SessionType.ScheduleCron,
      SessionType.ScheduleOnce,
      () => "scheduled" as const,
    )
    .with(SessionType.Invocation, () => null)
    .exhaustive();
}

export const DEFAULT_KIND_LABEL: Record<DefaultKind, string> = {
  chat: "chat",
  channel: "channel",
  scheduled: "scheduled",
};

export const DEFAULT_KIND_TITLE: Record<DefaultKind, string> = {
  chat: "Chat",
  channel: "Channel",
  scheduled: "Scheduled",
};
