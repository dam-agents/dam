import type { Db } from "db";
import { telegramConversations, eq } from "db";

export interface TelegramConversationBinding {
  agentId: string;
  authorizedBy: string;
  ambient: boolean;
}

export function findAgentByConversation(db: Db) {
  return async (
    conversationId: string,
  ): Promise<TelegramConversationBinding | null> => {
    const rows = await db
      .select({
        agentId: telegramConversations.agentId,
        authorizedBy: telegramConversations.authorizedBy,
        ambient: telegramConversations.ambient,
      })
      .from(telegramConversations)
      .where(eq(telegramConversations.conversationId, conversationId))
      .limit(1);
    return rows[0] ?? null;
  };
}

export function setConversationAmbient(db: Db) {
  return async (conversationId: string, ambient: boolean): Promise<void> => {
    await db
      .update(telegramConversations)
      .set({ ambient })
      .where(eq(telegramConversations.conversationId, conversationId));
  };
}

export function bindConversation(db: Db) {
  return async (
    conversationId: string,
    agentId: string,
    authorizedBy: string,
  ): Promise<"bound" | "conflict"> => {
    const inserted = await db
      .insert(telegramConversations)
      .values({ conversationId, agentId, authorizedBy })
      .onConflictDoNothing()
      .returning({ conversationId: telegramConversations.conversationId });
    return inserted.length > 0 ? "bound" : "conflict";
  };
}

export function unbindConversation(db: Db) {
  return async (conversationId: string): Promise<void> => {
    await db
      .delete(telegramConversations)
      .where(eq(telegramConversations.conversationId, conversationId));
  };
}

export function listConversationsByAgent(db: Db) {
  return async (agentId: string): Promise<string[]> => {
    const rows = await db
      .select({ conversationId: telegramConversations.conversationId })
      .from(telegramConversations)
      .where(eq(telegramConversations.agentId, agentId));
    return rows.map((r) => r.conversationId);
  };
}

export function listConversationsAuthorizedBy(db: Db) {
  return async (
    keycloakSub: string,
  ): Promise<{ conversationId: string; agentId: string }[]> =>
    db
      .select({
        conversationId: telegramConversations.conversationId,
        agentId: telegramConversations.agentId,
      })
      .from(telegramConversations)
      .where(eq(telegramConversations.authorizedBy, keycloakSub));
}

export function allConversationAgentIds(db: Db) {
  return async (): Promise<string[]> => {
    const rows = await db
      .selectDistinct({ agentId: telegramConversations.agentId })
      .from(telegramConversations);
    return rows.map((r) => r.agentId);
  };
}

export function deleteConversationsByAgent(db: Db) {
  return async (agentId: string): Promise<void> => {
    await db
      .delete(telegramConversations)
      .where(eq(telegramConversations.agentId, agentId));
  };
}
