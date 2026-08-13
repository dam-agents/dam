import { eq, sql, type Db, userFeatures } from "db";

export interface FeaturesRepository {
  listEnabled(owner: string): Promise<Record<string, boolean>>;
  upsert(owner: string, feature: string, enabled: boolean): Promise<void>;
}

export function createFeaturesRepository(db: Db): FeaturesRepository {
  return {
    async listEnabled(owner) {
      const rows = await db
        .select({
          feature: userFeatures.feature,
          enabled: userFeatures.enabled,
        })
        .from(userFeatures)
        .where(eq(userFeatures.owner, owner));
      return Object.fromEntries(rows.map((r) => [r.feature, r.enabled]));
    },

    async upsert(owner, feature, enabled) {
      await db
        .insert(userFeatures)
        .values({ owner, feature, enabled })
        .onConflictDoUpdate({
          target: [userFeatures.owner, userFeatures.feature],
          set: { enabled, updatedAt: sql`now()` },
        });
    },
  };
}
