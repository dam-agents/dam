import { eq, userBudgets, type Db } from "db";

export function createUserBudgetsReader(db: Db) {
  return {
    async ceiling(
      owner: string,
    ): Promise<{ cpu: string; memory: string } | null> {
      const [row] = await db
        .select({ cpu: userBudgets.cpu, memory: userBudgets.memory })
        .from(userBudgets)
        .where(eq(userBudgets.owner, owner));
      return row ?? null;
    },
  };
}
