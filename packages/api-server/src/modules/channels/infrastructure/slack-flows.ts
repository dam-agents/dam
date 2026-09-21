import type { TtlStore } from "../../../core/ttl-store.js";
import { createFlowStore, type FlowStore } from "./telegram-flows.js";

export interface SlackPendingBind {
  slackChannelId: string;
  teamId: string;
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
