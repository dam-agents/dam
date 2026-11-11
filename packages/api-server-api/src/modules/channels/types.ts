import type { z } from "zod";
import type { ChannelType } from "../shared.js";
import type { channelChoiceInputSchema } from "./router.js";

export type ChannelChoiceInput = z.infer<typeof channelChoiceInputSchema>;

export interface SlackChannelChoiceView {
  id: string;
  name: string;
  isPrivate: boolean;
  workspace: string | null;
}

export type SlackChannelChoicesView =
  { linked: false } | { linked: true; channels: SlackChannelChoiceView[] };

/**
 * UNIT_BOUNDARY_DESCRIPTION: Whether the Bridge can put an agent into the
 * owner's own 1:1 DM with the bot. `off` is an install that trusts no workspace
 * for email pairing; `linked` is a proven Slack identity; `pairable` is a
 * mailbox match the owner has not confirmed yet; `unavailable` says why nothing
 * can be offered, and is the answer that must suppress an offer rather than
 * produce one.
 */
export type SlackDmBridgeState = "off" | "linked" | "pairable" | "unavailable";

export interface SlackDmStatusView {
  state: SlackDmBridgeState;
  reason?: string;
  teamId?: string;
  slackUserId?: string;
  dmChannelId?: string;
}

export interface SlackDmConnectView {
  teamId: string;
  slackUserId: string;
  dmChannelId: string;
  /* UNIT_BOUNDARY_DESCRIPTION: what this call settled, so a caller can tell a
   * fresh pairing from one that was already there — `existing` is the
   * idempotent answer, where nothing was written and nothing was posted. */
  link: "created" | "existing";
  binding: "created" | "existing";
  isDefault: boolean;
  helloPosted: boolean;
}

export interface SlackDmDisconnectView {
  disconnected: number;
  threadsReleased: number;
  linksRemoved: number;
  /* UNIT_BOUNDARY_DESCRIPTION: DMs whose revoke did not finish. Their record
   * stays `revoking`, which already stops turns and delivery there, and
   * running the disconnect again finishes the cleanup. */
  incomplete: string[];
}

export interface ChannelsService {
  available: Partial<Record<ChannelType, boolean>>;
  telegramBotUsername: () => string | null;
  setChoice: (input: ChannelChoiceInput) => Promise<void>;
  slackChannelChoices: () => Promise<SlackChannelChoicesView>;
  slackDm: {
    status: () => Promise<SlackDmStatusView>;
    connect: (input: {
      agentId: string;
      purpose?: string;
    }) => Promise<SlackDmConnectView>;
    disconnect: (input: { agentId: string }) => Promise<SlackDmDisconnectView>;
  };
}
