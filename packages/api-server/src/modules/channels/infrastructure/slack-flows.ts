import type { FlowStore } from "./bind-flow-store.js";

export interface SlackPendingBind {
  slackChannelId: string;
  teamId: string;
  slackUserId: string;
  keycloakSub: string;
  channelTitle?: string;
  createdAt: number;
}

export type SlackBindFlowStore = FlowStore<SlackPendingBind>;
