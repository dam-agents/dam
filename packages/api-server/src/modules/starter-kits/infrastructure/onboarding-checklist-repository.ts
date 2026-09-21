import type { Db } from "db";
import { agents as agentsTable, eq, inArray } from "db";
import { z } from "zod";
import { onboardingStepSchema, type OnboardingStep } from "api-server-api";

const storedChecklistSchema = z.array(onboardingStepSchema);

export interface OnboardingChecklistRepository {
  readMany(agentIds: readonly string[]): Promise<Map<string, OnboardingStep[]>>;
  update<T extends OnboardingStep[] | null>(
    agentId: string,
    next: (current: OnboardingStep[] | null) => T,
  ): Promise<T>;
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

    async update(agentId, next) {
      return db.transaction(async (tx) => {
        const rows = await tx
          .select({ steps: agentsTable.onboardingChecklist })
          .from(agentsTable)
          .where(eq(agentsTable.id, agentId))
          .for("update");
        const steps = next(parseStored(rows[0]?.steps));
        if (steps !== null)
          await tx
            .update(agentsTable)
            .set({ onboardingChecklist: steps })
            .where(eq(agentsTable.id, agentId));
        return steps;
      });
    },
  };
}
