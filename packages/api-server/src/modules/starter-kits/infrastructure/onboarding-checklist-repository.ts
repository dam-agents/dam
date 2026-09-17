import type { Db } from "db";
import { agents as agentsTable, eq, inArray } from "db";
import { z } from "zod";
import { onboardingStepSchema, type OnboardingStep } from "api-server-api";

const storedChecklistSchema = z.array(onboardingStepSchema);

export interface OnboardingChecklistRepository {
  read(agentId: string): Promise<OnboardingStep[] | null>;
  readMany(agentIds: readonly string[]): Promise<Map<string, OnboardingStep[]>>;
  write(agentId: string, steps: OnboardingStep[]): Promise<void>;
}

function parseStored(raw: unknown): OnboardingStep[] | null {
  if (raw == null) return null;
  const parsed = storedChecklistSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function createOnboardingChecklistRepository(
  db: Db,
): OnboardingChecklistRepository {
  return {
    async read(agentId) {
      const rows = await db
        .select({ steps: agentsTable.onboardingChecklist })
        .from(agentsTable)
        .where(eq(agentsTable.id, agentId));
      return parseStored(rows[0]?.steps);
    },

    async readMany(agentIds) {
      const out = new Map<string, OnboardingStep[]>();
      if (agentIds.length === 0) return out;
      const rows = await db
        .select({ id: agentsTable.id, steps: agentsTable.onboardingChecklist })
        .from(agentsTable)
        .where(inArray(agentsTable.id, [...agentIds]));
      for (const row of rows) {
        const steps = parseStored(row.steps);
        if (steps) out.set(row.id, steps);
      }
      return out;
    },

    async write(agentId, steps) {
      await db
        .update(agentsTable)
        .set({ onboardingChecklist: steps })
        .where(eq(agentsTable.id, agentId));
    },
  };
}
