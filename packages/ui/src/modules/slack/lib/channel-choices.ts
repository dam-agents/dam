import type { SlackChannelChoiceView } from "api-server-api";

const CHANNEL_ID = /^[CG](?=[A-Z0-9]*[0-9])[A-Z0-9]{8,}$/;

export function looksLikeChannelId(text: string): boolean {
  return CHANNEL_ID.test(text);
}

export function matchChannels(
  channels: readonly SlackChannelChoiceView[],
  query: string,
): SlackChannelChoiceView[] {
  const needle = query.trim().replace(/^#/, "").toLowerCase();
  return channels.filter((c) => c.name.toLowerCase().includes(needle));
}

export function spansWorkspaces(
  channels: readonly SlackChannelChoiceView[],
): boolean {
  return new Set(channels.map((c) => c.workspace)).size > 1;
}
