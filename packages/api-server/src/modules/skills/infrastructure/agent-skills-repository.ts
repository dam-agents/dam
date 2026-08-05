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

  /** Anonymous-lane records whose pull request is due for a re-read as of
   *  `now`, across every agent — the resolver is background work, not
   *  owner-scoped. Due means the per-record backoff has elapsed: hourly for a
   *  record whose last attempt learned something, doubling per consecutive
   *  failed attempt up to daily; a record that keeps failing outright is
   *  eventually retired. Records marked `pr_needs_pod` never appear here —
   *  they are the pod lane's. */
  listPrStateCandidates(now: Date, limit: number): Promise<PrStateCandidate[]>;
  /** Pod-lane records due for a re-read: marked `pr_needs_pod`, same backoff
   *  and retirement as the anonymous lane. The caller filters to warm
   *  publishers before attempting anything, so rows returned here cost
   *  nothing until a pod is actually read. */
  listPodPrStateCandidates(
    now: Date,
    limit: number,
  ): Promise<PodPrStateCandidate[]>;

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
   *  the validator and grows the backoff. There is no outcome for "nothing
   *  was attempted": a record whose publishers were all cold is skipped
   *  without a stamp, keeping its place in the queue. */
  touchPrState(
    prUrl: string,
    checkedAt: Date,
    outcome: "confirmed" | "failed",
  ): Promise<void>;
  /** Flag every record of this pull request as unresolvable anonymously,
   *  discarding the validator. */
  markPrNeedsPod(prUrl: string): Promise<void>;

  deleteByAgent(agentId: string): Promise<void>;
}

type PrState = NonNullable<SkillPublishRecord["prState"]>;

/** One anonymous-lane row: a pull request the resolver may read anonymously,
 *  with its publisher (several agents can carry the same pull request — the
 *  service dedupes by URL) and the stored validator. */
export interface PrStateCandidate {
  agentId: string;
  prUrl: string;
  prEtag: string | null;
}

/** One pod-lane row: a pull request that resolves only through a publishing
 *  agent's pod. No validator — the pod path reads no ETag back. */
export interface PodPrStateCandidate {
  agentId: string;
  prUrl: string;
}

/** Consecutive outright failures after which a record is retired from the
 *  candidate set (~a month at the daily backoff cap), so dead records drain
 *  instead of holding a daily slot forever. */
const MAX_CHECK_FAILURES = 30;

/* Both lane queries share the same eligibility, differing only in which lane
 * a record belongs to (`pr_needs_pod`). */

// Terminal states are excluded here, not filtered later: `merged` and
// `closed` are immutable, so the working set shrinks with use instead of
// growing.
const nonTerminal = or(
  isNull(agentSkillPublishes.prState),
  inArray(agentSkillPublishes.prState, ["draft", "open"]),
);

const notRetired = sql`${agentSkillPublishes.prStateCheckFailures} < ${MAX_CHECK_FAILURES}`;

// Throttle every record. A conditional request is NOT exempt from the
// anonymous rate limit — measured against api.github.com, each 304 decrements
// x-ratelimit-remaining by one exactly like a 200 — so an ETag saves
// bandwidth but buys no budget, and re-checking on every tick would let ~10
// open pull requests exhaust the instance's whole hourly allowance. A record
// never attempted is exempt, so a fresh publish still resolves on the next
// tick. Two traps: the inner least() caps the *exponent* (power() is double
// precision and overflows at 2^1024, failing the whole query — WHERE
// conditions have no guaranteed evaluation order, so the retirement bound
// cannot shield it), and `now` crosses as an ISO string — raw sql`` params
// skip drizzle's column mappers, and drizzle's postgres-js driver replaces
// the driver's own date serializers with pass-throughs at construction, so a
// Date instance would reach the wire encoder unserialized and throw at Bind.
const backoffElapsed = (now: Date) =>
  or(
    isNull(agentSkillPublishes.prStateCheckedAt),
    sql`${agentSkillPublishes.prStateCheckedAt} + least(power(2, least(${agentSkillPublishes.prStateCheckFailures}, 5)), 24) * interval '1 hour' <= ${now.toISOString()}`,
  );

// NULLS FIRST, explicitly: Postgres sorts NULL last by default, which would
// put never-attempted records — a fresh publish, the case a user is actually
// watching — behind every already-attempted one and starve them whenever the
// backlog exceeds the per-tick page.
const oldestAttemptFirst = sql`${agentSkillPublishes.prStateCheckedAt} asc nulls first`;

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
        })
        .from(agentSkillPublishes)
        .where(
          and(
            eq(agentSkillPublishes.prNeedsPod, false),
            nonTerminal,
            notRetired,
            backoffElapsed(now),
          ),
        )
        .orderBy(oldestAttemptFirst)
        .limit(limit);
      return rows;
    },

    async listPodPrStateCandidates(now, limit) {
      const rows = await db
        .select({
          agentId: agentSkillPublishes.agentId,
          prUrl: agentSkillPublishes.prUrl,
        })
        .from(agentSkillPublishes)
        .where(
          and(
            eq(agentSkillPublishes.prNeedsPod, true),
            nonTerminal,
            notRetired,
            backoffElapsed(now),
          ),
        )
        .orderBy(oldestAttemptFirst)
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
            : { prStateCheckFailures: 0 }),
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
