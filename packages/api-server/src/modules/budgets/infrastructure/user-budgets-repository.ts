import { eq, userBudgets, type Db } from "db";
import type { ResourceAmount } from "../domain/resources.js";

export interface UserBudgetsRepository {
  /** The owner's explicit ceiling override, or null to fall back to the chart default. */
  ceiling(owner: string): Promise<ResourceAmount | null>;
}

export function createUserBudgetsRepository(db: Db): UserBudgetsRepository {
  return {
    async ceiling(owner) {
      const [row] = await db
        .select({
          cpuMilli: userBudgets.cpuMilli,
          memoryBytes: userBudgets.memoryBytes,
        })
        .from(userBudgets)
        .where(eq(userBudgets.owner, owner))
        .limit(1);
      return row ?? null;
    },
  };
}
