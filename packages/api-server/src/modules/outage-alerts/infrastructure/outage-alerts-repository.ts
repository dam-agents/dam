import { and, eq, outageAlerts, type Db } from "db";
import { z } from "zod";

import type { OutageAlert } from "../domain/alert-rules.js";

export interface StoredAlert {
  alert: OutageAlert;
  version: number;
}

export interface OutageAlertsRepository {
  listTold(): Promise<StoredAlert[]>;
  read(ownerSub: string, templateId: string): Promise<StoredAlert | null>;
  claim(seen: number | null, next: OutageAlert): Promise<boolean>;
}

const agentsSchema = z.array(
  z.object({
    agentId: z.string(),
    name: z.string(),
    affectedBy: z.array(z.enum(["failed-calls"])),
  }),
);

const stateSchema = z.enum(["told", "recovered"]);
const reasonSchema = z.enum([
  "failing-calls",
  "unreachable",
  "provider-reported",
]);

type Row = typeof outageAlerts.$inferSelect;

function readable(row: Row): boolean {
  return (
    stateSchema.safeParse(row.state).success &&
    reasonSchema.safeParse(row.reason).success
  );
}

function toStored(row: Row): StoredAlert {
  const agents = agentsSchema.safeParse(row.agents);
  return {
    alert: {
      ownerSub: row.ownerSub,
      templateId: row.templateId,
      state: stateSchema.parse(row.state),
      reason: reasonSchema.parse(row.reason),
      since: row.since,
      toldAt: row.toldAt,
      recoveredAt: row.recoveredAt,
      agents: agents.success ? agents.data : [],
      statusPageUrl: row.statusPageUrl,
    },
    version: row.version,
  };
}

export function createOutageAlertsRepository(db: Db): OutageAlertsRepository {
  return {
    async listTold() {
      const rows = await db
        .select()
        .from(outageAlerts)
        .where(eq(outageAlerts.state, "told"));
      return rows.filter(readable).map(toStored);
    },

    async read(ownerSub, templateId) {
      const [row] = await db
        .select()
        .from(outageAlerts)
        .where(
          and(
            eq(outageAlerts.ownerSub, ownerSub),
            eq(outageAlerts.templateId, templateId),
          ),
        )
        .limit(1);
      return row && readable(row) ? toStored(row) : null;
    },

    // UNIT_BOUNDARY_DESCRIPTION: writes the next alert only if nobody wrote one since it was read, and says whether this caller won. A message goes out only after a won claim, so two evaluations on two replicas never send the same message twice; a send that then fails is lost rather than repeated.
    async claim(seen, next) {
      const values = {
        state: next.state,
        reason: next.reason,
        since: next.since,
        toldAt: next.toldAt,
        recoveredAt: next.recoveredAt,
        agents: next.agents,
        statusPageUrl: next.statusPageUrl,
        updatedAt: new Date(),
      };
      if (seen === null) {
        const inserted = await db
          .insert(outageAlerts)
          .values({
            ownerSub: next.ownerSub,
            templateId: next.templateId,
            ...values,
            version: 1,
          })
          .onConflictDoNothing()
          .returning({ version: outageAlerts.version });
        return inserted.length > 0;
      }
      const updated = await db
        .update(outageAlerts)
        .set({ ...values, version: seen + 1 })
        .where(
          and(
            eq(outageAlerts.ownerSub, next.ownerSub),
            eq(outageAlerts.templateId, next.templateId),
            eq(outageAlerts.version, seen),
          ),
        )
        .returning({ version: outageAlerts.version });
      return updated.length > 0;
    },
  };
}
