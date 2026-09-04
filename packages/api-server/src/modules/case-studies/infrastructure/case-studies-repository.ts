import { randomUUID } from "node:crypto";
import {
  agentCaseStudies,
  and,
  desc,
  eq,
  gte,
  inArray,
  lt,
  or,
  sql,
  type Db,
} from "db";
import { caseStudyStatusSchema } from "api-server-api";
import type { CaseStudyStatus } from "api-server-api";
import type { EditionRecord } from "../domain/editions.js";

export interface UpsertEditionInput {
  agentId: string;
  editionWeekStart: string;
  windowStart: string;
  windowEnd: string;
  content: string;
  harnessImage: string | null;
  artifactId: string | null;
}

export interface ReleasedFilter {
  since?: Date;
  weekStart?: string;
  agentId?: string;
}

export interface CaseStudiesRepository {
  upsertEdition(input: UpsertEditionInput): Promise<EditionRecord>;
  getById(id: string): Promise<EditionRecord | null>;
  listByAgents(agentIds: readonly string[]): Promise<EditionRecord[]>;
  listReleased(filter: ReleasedFilter): Promise<EditionRecord[]>;
  setStatus(id: string, status: CaseStudyStatus): Promise<EditionRecord | null>;
  purge(createdBefore: Date, tombstonedBefore: Date): Promise<number>;
}

type Row = typeof agentCaseStudies.$inferSelect;

function parseRecord(row: Row): EditionRecord {
  return {
    id: row.id,
    agentId: row.agentId,
    editionWeekStart: row.editionWeekStart,
    windowStart: row.windowStart,
    windowEnd: row.windowEnd,
    content: row.content,
    harnessImage: row.harnessImage,
    artifactId: row.artifactId,
    status: caseStudyStatusSchema.catch("hidden").parse(row.status),
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createCaseStudiesRepository(db: Db): CaseStudiesRepository {
  return {
    async upsertEdition(input) {
      const rows = await db
        .insert(agentCaseStudies)
        .values({ id: randomUUID(), ...input })
        .onConflictDoUpdate({
          target: [agentCaseStudies.agentId, agentCaseStudies.editionWeekStart],
          set: {
            windowStart: input.windowStart,
            windowEnd: input.windowEnd,
            content: input.content,
            harnessImage: input.harnessImage,
            artifactId: input.artifactId,
            status: "pending",
            deletedAt: null,
            updatedAt: sql`now()`,
          },
        })
        .returning();
      return parseRecord(rows[0]!);
    },

    async getById(id) {
      const rows = await db
        .select()
        .from(agentCaseStudies)
        .where(eq(agentCaseStudies.id, id))
        .limit(1);
      const row = rows[0];
      return row ? parseRecord(row) : null;
    },

    async listByAgents(agentIds) {
      if (agentIds.length === 0) return [];
      const rows = await db
        .select()
        .from(agentCaseStudies)
        .where(inArray(agentCaseStudies.agentId, [...agentIds]))
        .orderBy(
          desc(agentCaseStudies.editionWeekStart),
          desc(agentCaseStudies.updatedAt),
        );
      return rows.map(parseRecord);
    },

    async listReleased(filter) {
      const conditions = [eq(agentCaseStudies.status, "released")];
      if (filter.since) {
        conditions.push(gte(agentCaseStudies.updatedAt, filter.since));
      }
      if (filter.weekStart) {
        conditions.push(
          eq(agentCaseStudies.editionWeekStart, filter.weekStart),
        );
      }
      if (filter.agentId) {
        conditions.push(eq(agentCaseStudies.agentId, filter.agentId));
      }
      const rows = await db
        .select()
        .from(agentCaseStudies)
        .where(and(...conditions))
        .orderBy(
          desc(agentCaseStudies.editionWeekStart),
          desc(agentCaseStudies.updatedAt),
        );
      return rows.map(parseRecord);
    },

    async setStatus(id, status) {
      const rows = await db
        .update(agentCaseStudies)
        .set({
          status,
          deletedAt: status === "deleted" ? sql`now()` : null,
          updatedAt: sql`now()`,
        })
        .where(eq(agentCaseStudies.id, id))
        .returning();
      const row = rows[0];
      return row ? parseRecord(row) : null;
    },

    async purge(createdBefore, tombstonedBefore) {
      const purged = await db
        .delete(agentCaseStudies)
        .where(
          or(
            lt(agentCaseStudies.createdAt, createdBefore),
            and(
              eq(agentCaseStudies.status, "deleted"),
              lt(agentCaseStudies.deletedAt, tombstonedBefore),
            ),
          ),
        )
        .returning({ id: agentCaseStudies.id });
      return purged.length;
    },
  };
}
