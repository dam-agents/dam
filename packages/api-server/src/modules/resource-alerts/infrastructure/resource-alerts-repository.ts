import { and, eq, resourceAlerts, type Db } from "db";

import type { AlertKind, AlertMark } from "../domain/alert-policy.js";

export interface StoredMark {
  mark: AlertMark;
  version: number | null;
}

export interface ResourceAlertsRepository {
  read(ownerSub: string, kind: AlertKind): Promise<StoredMark>;
  listOwners(kind: AlertKind, level: string): Promise<string[]>;
  claim(
    ownerSub: string,
    kind: AlertKind,
    seen: number | null,
    next: AlertMark,
  ): Promise<boolean>;
}

export function createResourceAlertsRepository(
  db: Db,
): ResourceAlertsRepository {
  return {
    async read(ownerSub, kind) {
      const [row] = await db
        .select()
        .from(resourceAlerts)
        .where(
          and(
            eq(resourceAlerts.ownerSub, ownerSub),
            eq(resourceAlerts.kind, kind),
          ),
        )
        .limit(1);
      return row
        ? {
            mark: {
              level: row.level,
              notifiedLevel: row.notifiedLevel,
              notifiedAt: row.notifiedAt,
            },
            version: row.version,
          }
        : {
            mark: { level: "ok", notifiedLevel: null, notifiedAt: null },
            version: null,
          };
    },

    async listOwners(kind, level) {
      const rows = await db
        .select({ ownerSub: resourceAlerts.ownerSub })
        .from(resourceAlerts)
        .where(
          and(eq(resourceAlerts.kind, kind), eq(resourceAlerts.level, level)),
        );
      return rows.map((r) => r.ownerSub);
    },

    // UNIT_BOUNDARY_DESCRIPTION: writes the next mark only if nobody wrote one since it was read, and says whether this caller won. A message goes out only after a won claim, so two ticks, or two replicas across a lease handover, never send the same alert twice; a send that then fails is lost rather than repeated.
    async claim(ownerSub, kind, seen, next) {
      const values = {
        level: next.level,
        notifiedLevel: next.notifiedLevel,
        notifiedAt: next.notifiedAt,
        updatedAt: new Date(),
      };
      if (seen === null) {
        const inserted = await db
          .insert(resourceAlerts)
          .values({ ownerSub, kind, ...values, version: 1 })
          .onConflictDoNothing()
          .returning({ version: resourceAlerts.version });
        return inserted.length > 0;
      }
      const updated = await db
        .update(resourceAlerts)
        .set({ ...values, version: seen + 1 })
        .where(
          and(
            eq(resourceAlerts.ownerSub, ownerSub),
            eq(resourceAlerts.kind, kind),
            eq(resourceAlerts.version, seen),
          ),
        )
        .returning({ version: resourceAlerts.version });
      return updated.length > 0;
    },
  };
}
