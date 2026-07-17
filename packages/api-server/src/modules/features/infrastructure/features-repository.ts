import { and, eq, sql, type Db, userFeatures } from "db";

export interface FeaturesRepository {
  /** Explicitly toggled features for an owner; absent = default (off). */
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

/** Boot-scoped single-flag read for surfaces composed outside a user request
 *  (the per-agent MCP session). */
export async function isFeatureEnabled(
  db: Db,
  owner: string,
  feature: string,
): Promise<boolean> {
  const [row] = await db
    .select({ enabled: userFeatures.enabled })
    .from(userFeatures)
    .where(
      and(eq(userFeatures.owner, owner), eq(userFeatures.feature, feature)),
    )
    .limit(1);
  return row?.enabled ?? false;
}
