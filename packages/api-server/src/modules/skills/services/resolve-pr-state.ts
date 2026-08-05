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
 * Everything about the pass is shaped by the 60-requests/hour-per-IP anonymous
 * ceiling, which is shared by every user of this api-server:
 *
 *  - terminal states excluded by the candidate query, so the working set
 *    shrinks with use rather than growing;
 *  - a per-record backoff, so cost is at most one request per unresolved pull
 *    request per hour and ~50 of them fit inside the ceiling — checking every
 *    record on every tick instead would let ten exhaust it. The backoff
 *    doubles per consecutive attempt that learns nothing (capped at a day),
 *    so a record that can never resolve — a private source whose agent stays
 *    hibernated, a deleted repo — decays to one request a day instead of
 *    spending its hourly slot forever;
 *
 * Note what is deliberately *not* on that list. Conditional requests do not
 * reduce the anonymous budget: measured against api.github.com, a 304
 * decrements `x-ratelimit-remaining` by one exactly like a 200 (GitHub's
 * "conditional requests are free" behaviour applies to the authenticated
 * primary limit). The ETag is still stored and sent — it saves bandwidth, and
 * the pod path in slice 04 runs against the user's own 5000/hour bucket where
 * the exemption does hold — but it must never be treated as a budget
 * exemption here.
 *
 * The tick is safe under at-least-once execution: every write is idempotent,
 * and a resolved state is never replaced with null.
 */
import type {
  AgentSkillsRepository,
  PrStateCandidate,
} from "../infrastructure/agent-skills-repository.js";
import type { PrStateReader } from "../infrastructure/pr-state-reader.js";
import {
  derivePrState,
  type PodPrStateReader,
  type PrDisposition,
} from "../domain/pr-state.js";
import { parsePrUrl } from "../domain/pr-url.js";

/** Backstop against a pathological backlog; the per-record backoff (owned by
 *  the candidate query) is what bounds spend in normal operation. Ten per tick
 *  at this interval *exactly* saturates the anonymous hourly ceiling rather
 *  than leaving headroom under it, so a saturated backlog spends the whole
 *  budget and depends on the `rate-limited` early return below to stay correct
 *  at the boundary — and any other anonymous GitHub call sharing this egress
 *  IP can tip such a tick into 429s. Terminal-state exclusion and the failure
 *  backoff are what drain the backlog over time. */
const MAX_READS_PER_TICK = 10;

export interface PrStateResolver {
  /** One pass; returns how many records had a state written. */
  tick(): Promise<number>;
}

export function createPrStateResolver(deps: {
  agentSkills: AgentSkillsRepository;
  reader: PrStateReader;
  /** Authenticated fallback for private sources, through the agent's own pod.
   *  Required, not optional: the adapter already expresses "cannot read right
   *  now" by returning null (stopped agent, failed call), so an absent port
   *  would only add a second way to say the same thing — one that fails silently
   *  as "private sources never resolve" instead of failing to compile. */
  podReader: PodPrStateReader;
  log: (msg: string) => void;
}): PrStateResolver {
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
          `backlog exceeds the per-tick cap; ${skipped}+ record(s) deferred to the next tick`,
        );
      }

      let resolved = 0;
      for (const candidate of groupByPrUrl(
        candidates.slice(0, MAX_READS_PER_TICK),
      )) {
        const coords = parsePrUrl(candidate.prUrl);
        if (!coords) {
          // Not a GitHub pull request URL, so no amount of retrying helps.
          // Stamp it anyway so it takes its turn in the backoff rather than
          // heading the candidate list forever.
          await deps.agentSkills.touchPrState(candidate.prUrl, now, "failed");
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
          await deps.agentSkills.touchPrState(
            candidate.prUrl,
            now,
            "confirmed",
          );
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
        // Escalate to a publishing agent's pod, whose gateway holds the token.
        // Every publisher is a candidate — records for the same pull request
        // can span agents, and only a warm pod answers — so try each until one
        // does; the reader declines a stopped agent without touching it.
        // Only `not-found`: an error or a rate limit says nothing about the
        // source being private.
        if (result.reason === "not-found") {
          let disposition: PrDisposition | null = null;
          for (const agentId of candidate.agentIds) {
            disposition = await deps.podReader.read(agentId, coords);
            if (disposition) break;
          }
          if (disposition) {
            await deps.agentSkills.setPrState(candidate.prUrl, {
              prState: derivePrState(disposition),
              checkedAt: now,
              // The pod path reads no ETag back, and the anonymous validator is
              // for a resource we just failed to see.
              etag: null,
            });
            resolved += 1;
            continue;
          }
        }
        // Unavailable: keep whatever state is already known — a blip must not
        // erase a resolved `merged` — but discard the validator, which belongs
        // to a resource we could not read. Keeping it risks a later 304 that
        // would assert a cached state we may not have.
        await deps.agentSkills.touchPrState(candidate.prUrl, now, "failed");
      }
      return resolved;
    },
  };
}

/** Several agents can carry a record for the same pull request; read it once
 *  — keeping every publisher's agentId for the pod escalation — and let the
 *  keyed-on-prUrl writes settle all of them. */
export function groupByPrUrl(
  candidates: PrStateCandidate[],
): { prUrl: string; prEtag: string | null; agentIds: string[] }[] {
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
