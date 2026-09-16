import {
  and,
  eq,
  notInArray,
  sql,
  type Db,
  starterKitCatalogEntries,
} from "db";
import type { ResolvedSkill, StarterKit } from "api-server-api";

export interface ResolvedKitRow {
  catalog: string;
  kitId: string;
  version: string;
  source: string;
  kit: StarterKit;
  skillsInKit: ResolvedSkill[];
}

export interface ResolvedCatalogRepository {
  list(): Promise<ResolvedKitRow[]>;
  get(catalog: string, kitId: string): Promise<ResolvedKitRow | null>;
  replaceCatalog(catalog: string, rows: ResolvedKitRow[]): Promise<void>;
}

function toRow(r: {
  catalog: string;
  kitId: string;
  version: string;
  source: string;
  kit: unknown;
  bundledSkills: unknown;
}): ResolvedKitRow {
  return {
    catalog: r.catalog,
    kitId: r.kitId,
    version: r.version,
    source: r.source,
    kit: r.kit as StarterKit,
    skillsInKit: (r.bundledSkills as ResolvedSkill[] | null) ?? [],
  };
}

export function createResolvedCatalogRepository(
  db: Db,
): ResolvedCatalogRepository {
  return {
    async list() {
      return (await db.select().from(starterKitCatalogEntries)).map(toRow);
    },

    async get(catalog, kitId) {
      const rows = await db
        .select()
        .from(starterKitCatalogEntries)
        .where(
          and(
            eq(starterKitCatalogEntries.catalog, catalog),
            eq(starterKitCatalogEntries.kitId, kitId),
          ),
        )
        .limit(1);
      return rows[0] ? toRow(rows[0]) : null;
    },

    async replaceCatalog(catalog, rows) {
      await db.transaction(async (tx) => {
        for (const row of rows) {
          await tx
            .insert(starterKitCatalogEntries)
            .values({
              catalog: row.catalog,
              kitId: row.kitId,
              version: row.version,
              source: row.source,
              kit: row.kit,
              bundledSkills: row.skillsInKit,
            })
            .onConflictDoUpdate({
              target: [
                starterKitCatalogEntries.catalog,
                starterKitCatalogEntries.kitId,
              ],
              set: {
                version: row.version,
                source: row.source,
                kit: row.kit,
                bundledSkills: row.skillsInKit,
                refreshedAt: sql`now()`,
              },
            });
        }
        const keep = rows.map((r) => r.kitId);
        await tx
          .delete(starterKitCatalogEntries)
          .where(
            keep.length > 0
              ? and(
                  eq(starterKitCatalogEntries.catalog, catalog),
                  notInArray(starterKitCatalogEntries.kitId, keep),
                )
              : eq(starterKitCatalogEntries.catalog, catalog),
          );
      });
    },
  };
}
