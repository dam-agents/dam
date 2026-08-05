import crypto from "node:crypto";
import type { Db } from "db";
import {
  agentSkills,
  agentSkillPublishes,
  eq,
  and,
  inArray,
  isNull,
  or,
  sql,
} from "db";
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

  /** Records whose pull request is due for a re-read as of `now`, across
   *  every agent — the resolver is background work, not owner-scoped. Due
   *  means the per-record backoff has elapsed: hourly for a record whose last
   *  attempt learned something, doubling per consecutive failed attempt up to
   *  daily; a record that keeps failing outright is eventually retired. */
  listPrStateCandidates(now: Date, limit: number): Promise<PrStateCandidate[]>;

  /** Persist a resolved state. Terminal states (`merged`, `closed`) are
   *  written once and the record is never selected for a re-read again, so
   *  this is the only writer of `prState`. Also resets the failure counter —
   *  the record is back in the hourly lane. */
  setPrState(
    prUrl: string,
    next: { prState: PrState; checkedAt: Date; etag: string | null },
  ): Promise<void>;
  /** Stamp an attempt that yielded no new state, so the record's backoff clock
   *  moves even when nothing was learned. Never touches `prState` — a
   *  rate-limit blip must not erase a resolved `merged`. `confirmed` (a 304)
   *  keeps the validator and resets the failure counter; `failed` discards
   *  the validator and grows the backoff; `deferred` (no publishing pod was
   *  warm, so no attempt actually happened) moves only the clock. */
  touchPrState(
    prUrl: string,
    checkedAt: Date,
    outcome: "confirmed" | "failed" | "deferred",
  ): Promise<void>;
  /** Flag every record of this pull request as unresolvable anonymously,
   *  discarding the validator. */
  markPrNeedsPod(prUrl: string): Promise<void>;

  deleteByAgent(agentId: string): Promise<void>;
}

type PrState = NonNullable<SkillPublishRecord["prState"]>;

/** One pull request the resolver may read, with the agent that published it
 *  (slice 04 escalates to that agent's pod) and the stored validator. */
export interface PrStateCandidate {
  agentId: string;
  prUrl: string;
  prEtag: string | null;
  /** True once an anonymous read has 404'd: skip the anonymous request and
   *  go straight to a publishing pod. */
  prNeedsPod: boolean;
}

/** Consecutive outright failures after which a record is retired from the
 *  candidate set (~a month at the daily backoff cap), so dead records drain
 *  instead of holding a daily slot forever. */
const MAX_CHECK_FAILURES = 30;

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
      const rows = await db
        .select({
          agentId: agentSkillPublishes.agentId,
          prUrl: agentSkillPublishes.prUrl,
          prEtag: agentSkillPublishes.prEtag,
          prNeedsPod: agentSkillPublishes.prNeedsPod,
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
            sql`${agentSkillPublishes.prStateCheckFailures} < ${MAX_CHECK_FAILURES}`,
            // Throttle every record. A conditional request is NOT exempt from
            // the anonymous rate limit — measured against api.github.com, each
            // 304 decrements x-ratelimit-remaining by one exactly like a 200 —
            // so an ETag saves bandwidth but buys no budget, and re-checking on
            // every tick would let ~10 open pull requests exhaust the
            // instance's whole hourly allowance. A record never attempted is
            // exempt, so a fresh publish still resolves on the next tick.
            // Two traps: the inner least() caps the *exponent* (power() is
            // double precision and overflows at 2^1024, failing the whole
            // query — WHERE conditions have no guaranteed evaluation order,
            // so the retirement bound cannot shield it), and `now` crosses as
            // an ISO string (raw sql`` params skip drizzle's column mappers
            // and postgres-js throws on a Date instance).
            or(
              isNull(agentSkillPublishes.prStateCheckedAt),
              sql`${agentSkillPublishes.prStateCheckedAt} + least(power(2, least(${agentSkillPublishes.prStateCheckFailures}, 5)), 24) * interval '1 hour' <= ${now.toISOString()}`,
            ),
          ),
        )
        // NULLS FIRST, explicitly: Postgres sorts NULL last by default, which
        // would put never-attempted records — a fresh publish, the case a user
        // is actually watching — behind every already-attempted one and starve
        // them whenever the backlog exceeds the per-tick cap.
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
          prStateCheckFailures: 0,
        })
        .where(eq(agentSkillPublishes.prUrl, prUrl));
    },

    async touchPrState(prUrl, checkedAt, outcome) {
      await db
        .update(agentSkillPublishes)
        .set({
          prStateCheckedAt: checkedAt,
          ...(outcome === "failed"
            ? {
                prEtag: null,
                prStateCheckFailures: sql`${agentSkillPublishes.prStateCheckFailures} + 1`,
              }
            : outcome === "confirmed"
              ? { prStateCheckFailures: 0 }
              : {}),
        })
        .where(eq(agentSkillPublishes.prUrl, prUrl));
    },

    async markPrNeedsPod(prUrl) {
      await db
        .update(agentSkillPublishes)
        .set({ prNeedsPod: true, prEtag: null })
        .where(eq(agentSkillPublishes.prUrl, prUrl));
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
