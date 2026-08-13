import crypto from "node:crypto";
import type { Db } from "db";
import {
  agentSkills,
  agentSkillPublishes,
  agents as agentsTable,
  eq,
  and,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "db";
import { z } from "zod";
import {
  localSkillSchema,
  type LocalSkill,
  type SkillRef,
  type SkillPublishRecord,
} from "api-server-api";

export interface AgentSkillsRepository {
  listSkills(agentId: string): Promise<SkillRef[]>;
  upsertSkill(agentId: string, ref: SkillRef): Promise<void>;
  removeSkill(
    agentId: string,
    key: { source: string; name: string },
  ): Promise<void>;
  removeBySource(agentIds: string[], gitUrl: string): Promise<void>;
  reconcile(agentId: string, presentNames: Set<string>): Promise<void>;

  listPublishes(agentId: string): Promise<SkillPublishRecord[]>;
  appendPublish(agentId: string, record: SkillPublishRecord): Promise<void>;

  listPrStateCandidates(now: Date, limit: number): Promise<PrStateCandidate[]>;

  setPrState(
    prUrl: string,
    next: { prState: PrState; checkedAt: Date; etag: string | null },
  ): Promise<void>;
  touchPrState(prUrl: string, checkedAt: Date): Promise<void>;

  readStandaloneSnapshot(
    agentId: string,
  ): Promise<{ skills: LocalSkill[]; capturedAt: string } | null>;
  recordStandaloneSnapshot(
    agentId: string,
    skills: LocalSkill[],
  ): Promise<void>;

  deleteByAgent(agentId: string): Promise<void>;
}

const standaloneSnapshotSchema = z.object({
  skills: z.array(localSkillSchema),
  capturedAt: z.string().datetime(),
});

type PrState = NonNullable<SkillPublishRecord["prState"]>;

export interface PrStateCandidate {
  agentId: string;
  prUrl: string;
  prEtag: string | null;
}

function generatePublishId(): string {
  return `pub-${crypto.randomBytes(8).toString("hex")}`;
}

export function createAgentSkillsRepository(db: Db): AgentSkillsRepository {
  return {
    async listSkills(agentId) {
      const rows = await db
        .select()
        .from(agentSkills)
        .where(eq(agentSkills.agentId, agentId));
      return rows.map((r) => ({
        source: r.source,
        name: r.name,
        version: r.version,
        ...(r.contentHash !== null ? { contentHash: r.contentHash } : {}),
        ...(r.path !== null ? { path: r.path } : {}),
      }));
    },

    async upsertSkill(agentId, ref) {
      await db
        .insert(agentSkills)
        .values({
          agentId,
          source: ref.source,
          name: ref.name,
          version: ref.version,
          contentHash: ref.contentHash ?? null,
          path: ref.path ?? null,
        })
        .onConflictDoUpdate({
          target: [agentSkills.agentId, agentSkills.source, agentSkills.name],
          set: {
            version: ref.version,
            contentHash: ref.contentHash ?? null,
            path: ref.path ?? null,
          },
        });
    },

    async removeSkill(agentId, key) {
      await db
        .delete(agentSkills)
        .where(
          and(
            eq(agentSkills.agentId, agentId),
            eq(agentSkills.source, key.source),
            eq(agentSkills.name, key.name),
          ),
        );
    },

    async removeBySource(agentIds, gitUrl) {
      if (agentIds.length === 0) return;
      await db
        .delete(agentSkills)
        .where(
          and(
            inArray(agentSkills.agentId, agentIds),
            eq(agentSkills.source, gitUrl),
          ),
        );
    },

    async reconcile(agentId, presentNames) {
      const rows = await db
        .select({ name: agentSkills.name, source: agentSkills.source })
        .from(agentSkills)
        .where(eq(agentSkills.agentId, agentId));
      const ghosts = rows.filter((r) => !presentNames.has(r.name));
      if (ghosts.length === 0) return;
      await Promise.all(
        ghosts.map((g) =>
          db
            .delete(agentSkills)
            .where(
              and(
                eq(agentSkills.agentId, agentId),
                eq(agentSkills.source, g.source),
                eq(agentSkills.name, g.name),
              ),
            ),
        ),
      );
    },

    async listPublishes(agentId) {
      const rows = await db
        .select()
        .from(agentSkillPublishes)
        .where(eq(agentSkillPublishes.agentId, agentId))
        .orderBy(agentSkillPublishes.publishedAt);
      return rows.map((r) => ({
        skillName: r.skillName,
        sourceId: r.sourceId,
        sourceName: r.sourceName,
        sourceGitUrl: r.sourceGitUrl,
        prUrl: r.prUrl,
        publishedAt: r.publishedAt.toISOString(),
        prState: r.prState as SkillPublishRecord["prState"],
        prStateCheckedAt: r.prStateCheckedAt?.toISOString() ?? null,
      }));
    },

    async appendPublish(agentId, record) {
      await db.insert(agentSkillPublishes).values({
        id: generatePublishId(),
        agentId,
        skillName: record.skillName,
        sourceId: record.sourceId,
        sourceName: record.sourceName,
        sourceGitUrl: record.sourceGitUrl,
        prUrl: record.prUrl,
        publishedAt: new Date(record.publishedAt),
      });
    },

    async listPrStateCandidates(now, limit) {
      const staleBefore = new Date(now.getTime() - 60 * 60 * 1000);
      const rows = await db
        .select({
          agentId: agentSkillPublishes.agentId,
          prUrl: agentSkillPublishes.prUrl,
          prEtag: agentSkillPublishes.prEtag,
        })
        .from(agentSkillPublishes)
        .where(
          and(
            or(
              isNull(agentSkillPublishes.prState),
              inArray(agentSkillPublishes.prState, ["draft", "open"]),
            ),
            or(
              isNull(agentSkillPublishes.prStateCheckedAt),
              lte(agentSkillPublishes.prStateCheckedAt, staleBefore),
            ),
          ),
        )
        .orderBy(sql`${agentSkillPublishes.prStateCheckedAt} asc nulls first`)
        .limit(limit);
      return rows;
    },

    async setPrState(prUrl, next) {
      await db
        .update(agentSkillPublishes)
        .set({
          prState: next.prState,
          prStateCheckedAt: next.checkedAt,
          prEtag: next.etag,
        })
        .where(eq(agentSkillPublishes.prUrl, prUrl));
    },

    async touchPrState(prUrl, checkedAt) {
      await db
        .update(agentSkillPublishes)
        .set({ prStateCheckedAt: checkedAt })
        .where(eq(agentSkillPublishes.prUrl, prUrl));
    },

    async readStandaloneSnapshot(agentId) {
      const rows = await db
        .select({ snapshot: agentsTable.skillsSnapshot })
        .from(agentsTable)
        .where(eq(agentsTable.id, agentId));
      const raw = rows[0]?.snapshot;
      if (raw == null) return null;
      const parsed = standaloneSnapshotSchema.safeParse(raw);
      return parsed.success ? parsed.data : null;
    },

    async recordStandaloneSnapshot(agentId, skills) {
      const stored = await db
        .select({ snapshot: agentsTable.skillsSnapshot })
        .from(agentsTable)
        .where(eq(agentsTable.id, agentId));
      const previous = standaloneSnapshotSchema.safeParse(
        stored[0]?.snapshot ?? null,
      );
      if (previous.success && sameSkills(previous.data.skills, skills)) return;
      await db
        .update(agentsTable)
        .set({
          skillsSnapshot: { skills, capturedAt: new Date().toISOString() },
        })
        .where(eq(agentsTable.id, agentId));
    },

    async deleteByAgent(agentId) {
      await Promise.all([
        db.delete(agentSkills).where(eq(agentSkills.agentId, agentId)),
        db
          .delete(agentSkillPublishes)
          .where(eq(agentSkillPublishes.agentId, agentId)),
      ]);
    },
  };
}

function sameSkills(a: LocalSkill[], b: LocalSkill[]): boolean {
  if (a.length !== b.length) return false;
  const byName = new Map(a.map((s) => [s.name, s]));
  return b.every((s) => {
    const other = byName.get(s.name);
    return (
      other !== undefined &&
      other.description === s.description &&
      other.skillPath === s.skillPath &&
      other.origin === s.origin &&
      other.contentHash === s.contentHash
    );
  });
}
