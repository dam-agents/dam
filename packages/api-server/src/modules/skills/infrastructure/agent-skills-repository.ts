import crypto from "node:crypto";
import type { Db } from "db";
import { agentSkills, agentSkillPublishes, eq, and, inArray } from "db";
import type { SkillRef, SkillPublishRecord } from "api-server-api";

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

  deleteByAgent(agentId: string): Promise<void>;
}

function generatePublishId(): string {
  return `pub-${crypto.randomBytes(8).toString("hex")}`;
}

/** Postgres-backed installed-refs + publish records, both keyed by
 *  agentId. Lifecycle is bounded by the agent: rows go away when the
 *  agent is deleted, via the AgentDeleted saga in the Skills module. */
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
      // Drop tracked refs whose directories vanished from the pod's filesystem
      // (manual rm, PVC wipe, etc). The filesystem is authoritative for "what
      // is installed" — spec catches up.
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
