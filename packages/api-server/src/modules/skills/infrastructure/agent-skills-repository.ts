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

  /** Records whose pull request is due for a re-read as of `now`, across
   *  every agent — the resolver is background work, not owner-scoped. Due
   *  means never attempted, or last attempted over an hour ago. */
  listPrStateCandidates(now: Date, limit: number): Promise<PrStateCandidate[]>;

  /** Persist a resolved state. Terminal states (`merged`, `closed`) are
   *  written once and the record is never selected for a re-read again, so
   *  this is the only writer of `prState`. */
  setPrState(
    prUrl: string,
    next: { prState: PrState; checkedAt: Date; etag: string | null },
  ): Promise<void>;
  /** Stamp an attempt that yielded no new state, so the record waits its
   *  hour before the next one. Never touches `prState` — a blip must not
   *  erase a resolved `merged`. */
  touchPrState(prUrl: string, checkedAt: Date): Promise<void>;

  /** The last recorded standalone list, or null when nothing was ever recorded
   *  — which is a never-run sandbox, not one with no standalone skills. */
  readStandaloneSnapshot(
    agentId: string,
  ): Promise<{ skills: LocalSkill[]; capturedAt: string } | null>;
  /** Records the list, skipping the write when it matches what's stored. The
   *  Skills surface polls `state` every few seconds while open, so an
   *  unconditional write would be one row update per open page per poll. */
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

/** One candidate row: a pull request the resolver may read, with its
 *  publisher (several agents can carry the same pull request — the service
 *  dedupes by URL, keeping every agentId for the pod escalation) and the
 *  stored validator. */
export interface PrStateCandidate {
  agentId: string;
  prUrl: string;
  prEtag: string | null;
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
        // Cast because the column is `text` (widening the value set should not
        // need a migration); the Zod schema at the tRPC edge enforces the union.
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
      // Re-check any one record at most hourly. A conditional request is NOT
      // exempt from the anonymous rate limit — measured against
      // api.github.com, each 304 decrements x-ratelimit-remaining by one
      // exactly like a 200 — so an ETag saves bandwidth but buys no budget,
      // and re-checking on every tick would let ~10 open pull requests
      // exhaust the instance's whole hourly allowance. A record never
      // attempted is exempt, so a fresh publish still resolves on the next
      // tick. The interval math deliberately stays in JS: a Date through the
      // column mapper is safe, whereas a raw sql`` param skips the mappers
      // (and drizzle's postgres-js driver disables the driver's own date
      // serializers), which is what silently killed this query once before.
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
            // Terminal states are excluded here, not filtered later: `merged`
            // and `closed` are immutable, so the working set shrinks with use
            // instead of growing.
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
        // NULLS FIRST, explicitly: Postgres sorts NULL last by default, which
        // would put never-attempted records — a fresh publish, the case a
        // user is actually watching — behind every already-attempted one and
        // starve them whenever the backlog exceeds the per-tick page.
        .orderBy(sql`${agentSkillPublishes.prStateCheckedAt} asc nulls first`)
        .limit(limit);
      return rows;
    },

    // Keyed on prUrl, not (agentId, skillName): the same pull request can be
    // referenced by records for different agents, and one read should settle
    // all of them.
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
      // The validator survives a failed attempt on purpose: an ETag is only
      // ever written together with the state it validates, so a later 304
      // always confirms a state we do have.
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
      // A shape written by an older build reads as "nothing recorded" rather
      // than breaking the panel this feeds.
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

/** Compared on the fields that decide what renders, by name rather than by
 *  position — the pod's ordering is not a promise. */
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
