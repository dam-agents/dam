import type { FlowStore } from "./bind-flow-store.js";

export interface TelegramOAuthPending {
  telegramUserId: string;
  threadId: string;
  codeVerifier: string;
  chatTitle?: string;
  createdAt: number;
}

export interface TelegramPendingBind {
  conversationId: string;
  telegramUserId: string;
  keycloakSub: string;
  chatTitle?: string;
  createdAt: number;
}

export type TelegramBindFlowStore = FlowStore<TelegramPendingBind>;
