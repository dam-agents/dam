import type { TtlStore } from "../../../core/ttl-store.js";
import { createFlowStore, type FlowStore } from "./telegram-flows.js";

/** A completed Keycloak login for an in-chat Slack bind, waiting for the owner
 *  to pick an Agent in the UI. The record is the bearer capability behind
 *  `?flow=<id>`: it pins the authenticated sub, so only that user's session can
 *  consume it. Mirrors {@link TelegramPendingBind}. */
export interface SlackPendingBind {
  slackChannelId: string;
  slackUserId: string;
  keycloakSub: string;
  channelTitle?: string;
  createdAt: number;
}

export type SlackBindFlowStore = FlowStore<SlackPendingBind>;

export function createSlackBindFlowStore(opts: {
  now?: () => number;
  store: TtlStore<SlackPendingBind>;
}): SlackBindFlowStore {
  return createFlowStore<SlackPendingBind>(opts);
}
