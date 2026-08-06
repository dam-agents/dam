/**
 * Re-reads the pull requests behind publish records so the Skills badge can
 * say what actually became of them.
 *
 * This is only the tick — scheduling lives on the platform periodic-jobs
 * queue, so exactly one pass runs per interval across replicas. Resolving here
 * rather than inside the `state` query is deliberate: it makes GitHub cost a
 * function of how many unresolved pull requests exist, not of how many users
 * have the Skills page open.
 *
 * The pass is deliberately flat — no backoff, no failure accounting, no
 * per-record state. Each unresolved record gets at most one attempt per hour:
 * an anonymous read (public sources; the shared 60-requests/hour-per-IP
 * anonymous ceiling is the budget), escalating on a 404 to the publishers'
 * own pods — the owner's authenticated bucket — but only to pods that are
 * already warm, because a badge is never worth waking an agent. Whatever the
 * attempt learned, the record is stamped and waits its hour. The working set
 * shrinks by resolution (terminal states are excluded by the candidate
 * query) and by agent deletion (the skills cleanup saga removes an agent's
 * records with it). The budget holds until ~50 concurrently unresolved
 * records — far above any observed population; scheduling sophistication is
 * deliberately deferred until reality demands it.
 *
 * Note what is deliberately *not* part of the budget: conditional requests.
 * Measured against api.github.com, an anonymous 304 decrements
 * `x-ratelimit-remaining` by one exactly like a 200 (GitHub's "conditional
 * requests are free" behaviour applies to the authenticated primary limit).
 * The ETag is still stored and sent — it saves bandwidth — but it must never
 * be treated as a budget exemption here.
 *
 * The tick is safe under at-least-once execution: every write is idempotent,
 * and a resolved state is never replaced with null.
 */
import type {
  AgentSkillsRepository,
  PrStateCandidate,
} from "../infrastructure/agent-skills-repository.js";
import type { PrStateReader } from "../infrastructure/pr-state-reader.js";
import { derivePrState, type PodPrStateReader } from "../domain/pr-state.js";
import type { PrCoordinates } from "../domain/pr-url.js";
import { parsePrUrl } from "../domain/pr-url.js";

/** Backstop against a pathological backlog; the hourly per-record throttle
 *  (owned by the candidate query) is what bounds spend in normal operation.
 *  Ten per tick at this interval *exactly* saturates the anonymous hourly
 *  ceiling rather than leaving headroom under it, so a saturated backlog
 *  spends the whole budget and depends on the `rate-limited` early return
 *  below to stay correct at the boundary — and any other anonymous GitHub
 *  call sharing this egress IP can tip such a tick into 429s. */
const MAX_READS_PER_TICK = 10;

export interface PrStateResolver {
  /** One pass; returns how many records had a state written. */
  tick(): Promise<number>;
}

interface ResolverDeps {
  agentSkills: AgentSkillsRepository;
  reader: PrStateReader;
  /** Authenticated fallback for private sources, through the agent's own pod.
   *  Required, not optional: the adapter already expresses "cannot read right
   *  now" as a value in its result union (`not-running` / `failed`), so an
   *  absent port would only add a second way to say the same thing — one that
   *  fails silently as "private sources never resolve" instead of failing to
   *  compile. */
  podReader: PodPrStateReader;
  log: (msg: string) => void;
}

export function createPrStateResolver(deps: ResolverDeps): PrStateResolver {
  return {
    async tick() {
      const now = new Date();
      // One extra so a full page is evidence of a backlog rather than a
      // coincidence, and the log can say so honestly.
      const candidates = await deps.agentSkills.listPrStateCandidates(
        now,
        MAX_READS_PER_TICK + 1,
      );
      const skipped = Math.max(0, candidates.length - MAX_READS_PER_TICK);
      if (skipped > 0) {
        deps.log(
          `backlog exceeds the per-tick cap; ${skipped}+ record(s) wait for the next tick`,
        );
      }

      let resolved = 0;
      for (const candidate of groupByPrUrl(
        candidates.slice(0, MAX_READS_PER_TICK),
      )) {
        const coords = parsePrUrl(candidate.prUrl);
        if (!coords) {
          // Not a GitHub pull request URL, so no amount of retrying helps —
          // but stamp it so it waits its hour like everything else instead
          // of heading the candidate list on every tick.
          await deps.agentSkills.touchPrState(candidate.prUrl, now);
          continue;
        }

        const result = await deps.reader.read(coords, candidate.prEtag);
        if (result.kind === "state") {
          await deps.agentSkills.setPrState(candidate.prUrl, {
            prState: result.prState,
            checkedAt: now,
            etag: result.etag,
          });
          resolved += 1;
          continue;
        }
        if (result.kind === "notModified") {
          await deps.agentSkills.touchPrState(candidate.prUrl, now);
          continue;
        }
        if (result.reason === "rate-limited") {
          // Stop the whole pass: every further read this window is certain to
          // fail, and attempting them would burn the next window too.
          deps.log(
            `anonymous rate limit exhausted; ${resolved} record(s) resolved before stopping`,
          );
          return resolved;
        }
        // A 404 means "not resolvable anonymously" — private as much as gone.
        // The publishers' own pods can see a private source's pull request
        // (the paired gateway injects the owner's token), so try them before
        // giving up on this attempt. Only `not-found`: an error or a rate
        // limit says nothing about the source being private.
        if (result.reason === "not-found") {
          resolved += await resolveThroughPods(deps, candidate, coords, now);
          continue;
        }
        // Unavailable: keep whatever state is already known — a blip must not
        // erase a resolved `merged` — and wait the hour.
        await deps.agentSkills.touchPrState(candidate.prUrl, now);
      }
      return resolved;
    },
  };
}

/** Try each publisher's pod until one answers. The reader never wakes an
 *  agent — a cold pod reports `not-running` — so this costs nothing while
 *  every publisher sleeps; the record keeps its hourly cadence and catches
 *  the next warm window. */
async function resolveThroughPods(
  deps: Pick<ResolverDeps, "agentSkills" | "podReader">,
  candidate: { prUrl: string; agentIds: string[] },
  coords: PrCoordinates,
  now: Date,
): Promise<number> {
  for (const agentId of candidate.agentIds) {
    const result = await deps.podReader.read(agentId, coords);
    if (result.kind === "state") {
      await deps.agentSkills.setPrState(candidate.prUrl, {
        prState: derivePrState(result.disposition),
        checkedAt: now,
        // The pod path reads no ETag back, and any anonymous validator is for
        // a resource the anonymous path cannot see.
        etag: null,
      });
      return 1;
    }
    // `not-running` and `failed` alike: this pod taught us nothing.
  }
  await deps.agentSkills.touchPrState(candidate.prUrl, now);
  return 0;
}

/** Several agents can carry a record for the same pull request; read it once
 *  — keeping every publisher's agentId for the pod escalation — and let the
 *  keyed-on-prUrl writes settle all of them. */
export function groupByPrUrl(candidates: PrStateCandidate[]): {
  prUrl: string;
  prEtag: string | null;
  agentIds: string[];
}[] {
  const byUrl = new Map<
    string,
    { prUrl: string; prEtag: string | null; agentIds: string[] }
  >();
  for (const c of candidates) {
    const group = byUrl.get(c.prUrl);
    if (!group) {
      byUrl.set(c.prUrl, {
        prUrl: c.prUrl,
        prEtag: c.prEtag,
        agentIds: [c.agentId],
      });
    } else if (!group.agentIds.includes(c.agentId)) {
      group.agentIds.push(c.agentId);
    }
  }
  return [...byUrl.values()];
}
