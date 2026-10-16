import type { Db } from "db";
import { agentChatFormPreferences, eq } from "db";
import {
  readChatFormPreferences,
  type ChatFormPreferences,
} from "api-server-api/chat-forms";

export interface ChatFormPreferencesRepository {
  get(agentId: string): Promise<ChatFormPreferences>;
  set(agentId: string, preferences: ChatFormPreferences): Promise<void>;
  deleteForAgent(agentId: string): Promise<void>;
  listAgentIds(): Promise<string[]>;
}

export function createChatFormPreferencesRepository(
  db: Db,
): ChatFormPreferencesRepository {
  return {
    async get(agentId) {
      const [row] = await db
        .select({ preferences: agentChatFormPreferences.preferences })
        .from(agentChatFormPreferences)
        .where(eq(agentChatFormPreferences.agentId, agentId));
      return readChatFormPreferences(row?.preferences);
    },

    async set(agentId, preferences) {
      await db
        .insert(agentChatFormPreferences)
        .values({ agentId, preferences })
        .onConflictDoUpdate({
          target: agentChatFormPreferences.agentId,
          set: { preferences, updatedAt: new Date() },
        });
    },

    async deleteForAgent(agentId) {
      await db
        .delete(agentChatFormPreferences)
        .where(eq(agentChatFormPreferences.agentId, agentId));
    },

    async listAgentIds() {
      const rows = await db
        .select({ agentId: agentChatFormPreferences.agentId })
        .from(agentChatFormPreferences);
      return rows.map((r) => r.agentId);
    },
  };
}
