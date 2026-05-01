import crypto from "node:crypto";
import type { Db } from "db";
import { instanceSkills, instanceSkillPublishes, eq, and, inArray } from "db";
import type { SkillRef, SkillPublishRecord } from "api-server-api";

export interface InstanceSkillsRepository {
  listSkills(instanceId: string): Promise<SkillRef[]>;
  upsertSkill(instanceId: string, ref: SkillRef): Promise<void>;
  removeSkill(instanceId: string, key: { source: string; name: string }): Promise<void>;
  removeBySource(instanceIds: string[], gitUrl: string): Promise<void>;
  reconcile(instanceId: string, presentNames: Set<string>): Promise<void>;

  listPublishes(instanceId: string): Promise<SkillPublishRecord[]>;
  appendPublish(instanceId: string, record: SkillPublishRecord): Promise<void>;

  deleteByInstance(instanceId: string): Promise<void>;
}

function generatePublishId(): string {
  return `pub-${crypto.randomBytes(8).toString("hex")}`;
}

/** Postgres-backed installed-refs + publish records, both keyed by
 *  instanceId. Lifecycle is bounded by the instance: rows go away when the
 *  instance is deleted, via the InstanceDeleted saga in the Skills module. */
export function createInstanceSkillsRepository(db: Db): InstanceSkillsRepository {
  return {
    async listSkills(instanceId) {
      const rows = await db
        .select()
        .from(instanceSkills)
        .where(eq(instanceSkills.instanceId, instanceId));
      return rows.map((r) => ({
        source: r.source,
        name: r.name,
        version: r.version,
        ...(r.contentHash !== null ? { contentHash: r.contentHash } : {}),
      }));
    },

    async upsertSkill(instanceId, ref) {
      await db
        .insert(instanceSkills)
        .values({
          instanceId,
          source: ref.source,
          name: ref.name,
          version: ref.version,
          contentHash: ref.contentHash ?? null,
        })
        .onConflictDoUpdate({
          target: [instanceSkills.instanceId, instanceSkills.source, instanceSkills.name],
          set: {
            version: ref.version,
            contentHash: ref.contentHash ?? null,
          },
        });
    },

    async removeSkill(instanceId, key) {
      await db
        .delete(instanceSkills)
        .where(
          and(
            eq(instanceSkills.instanceId, instanceId),
            eq(instanceSkills.source, key.source),
            eq(instanceSkills.name, key.name),
          ),
        );
    },

    async removeBySource(instanceIds, gitUrl) {
      if (instanceIds.length === 0) return;
      await db
        .delete(instanceSkills)
        .where(
          and(
            inArray(instanceSkills.instanceId, instanceIds),
            eq(instanceSkills.source, gitUrl),
          ),
        );
    },

    async reconcile(instanceId, presentNames) {
      // Drop tracked refs whose directories vanished from the pod's filesystem
      // (manual rm, PVC wipe, etc). The filesystem is authoritative for "what
      // is installed" — spec catches up.
      const rows = await db
        .select({ name: instanceSkills.name, source: instanceSkills.source })
        .from(instanceSkills)
        .where(eq(instanceSkills.instanceId, instanceId));
      const ghosts = rows.filter((r) => !presentNames.has(r.name));
      if (ghosts.length === 0) return;
      // Tiny n in practice — N skills installed on one instance — sequential
      // deletes are fine and avoid building an OR clause.
      await Promise.all(
        ghosts.map((g) =>
          db
            .delete(instanceSkills)
            .where(
              and(
                eq(instanceSkills.instanceId, instanceId),
                eq(instanceSkills.source, g.source),
                eq(instanceSkills.name, g.name),
              ),
            ),
        ),
      );
    },

    async listPublishes(instanceId) {
      const rows = await db
        .select()
        .from(instanceSkillPublishes)
        .where(eq(instanceSkillPublishes.instanceId, instanceId))
        .orderBy(instanceSkillPublishes.publishedAt);
      return rows.map((r) => ({
        skillName: r.skillName,
        sourceId: r.sourceId,
        sourceName: r.sourceName,
        sourceGitUrl: r.sourceGitUrl,
        prUrl: r.prUrl,
        publishedAt: r.publishedAt.toISOString(),
      }));
    },

    async appendPublish(instanceId, record) {
      await db.insert(instanceSkillPublishes).values({
        id: generatePublishId(),
        instanceId,
        skillName: record.skillName,
        sourceId: record.sourceId,
        sourceName: record.sourceName,
        sourceGitUrl: record.sourceGitUrl,
        prUrl: record.prUrl,
        publishedAt: new Date(record.publishedAt),
      });
    },

    async deleteByInstance(instanceId) {
      await Promise.all([
        db.delete(instanceSkills).where(eq(instanceSkills.instanceId, instanceId)),
        db.delete(instanceSkillPublishes).where(eq(instanceSkillPublishes.instanceId, instanceId)),
      ]);
    },
  };
}
