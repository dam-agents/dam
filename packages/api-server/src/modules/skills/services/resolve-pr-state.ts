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
 * A tick is two passes over two disjoint sets of records:
 *
 *  - The **anonymous pass** reads public pull requests from the api-server,
 *    shaped entirely by the 60-requests/hour-per-IP anonymous ceiling that is
 *    shared by every user of this api-server: terminal states are excluded by
 *    the candidate query so the working set shrinks with use; a per-record
 *    backoff doubles per consecutive failed attempt (capped at a day) and
 *    past a bound the record is retired outright; and a pull request the
 *    anonymous read has once 404'd is marked `pr_needs_pod` and leaves this
 *    pass for good.
 *  - The **pod pass** reads marked records through a publishing agent's own
 *    pod — the user's authenticated bucket, so nothing anonymous is spent —
 *    and only ever through *warm* pods. Cold publishers are filtered out
 *    before any attempt, so a sleeping agent's record is skipped without a
 *    stamp: its clock doesn't move, its failure count doesn't grow, and it
 *    keeps its place in the queue until a warm sample happens or the record
 *    is deleted with its agent. An idle deployment skips the pass without
 *    touching the cluster API at all.
 *
 * Note what is deliberately *not* on the anonymous list. Conditional requests
 * do not reduce the anonymous budget: measured against api.github.com, a 304
 * decrements `x-ratelimit-remaining` by one exactly like a 200 (GitHub's
 * "conditional requests are free" behaviour applies to the authenticated
 * primary limit). The ETag is still stored and sent — it saves bandwidth, and
 * the pod pass runs against the user's own 5000/hour bucket where the
 * exemption does hold — but it must never be treated as a budget exemption
 * here.
 *
 * The tick is safe under at-least-once execution: every write is idempotent,
 * and a resolved state is never replaced with null.
 */
import type {
  AgentSkillsRepository,
  PrStateCandidate,
  PodPrStateCandidate,
} from "../infrastructure/agent-skills-repository.js";
import type { PrStateReader } from "../infrastructure/pr-state-reader.js";
import { derivePrState, type PodPrStateReader } from "../domain/pr-state.js";
import type { PrCoordinates } from "../domain/pr-url.js";
import { parsePrUrl } from "../domain/pr-url.js";

/** Backstop against a pathological backlog; the per-record backoff (owned by
 *  the candidate query) is what bounds spend in normal operation. Ten per tick
 *  at this interval *exactly* saturates the anonymous hourly ceiling rather
 *  than leaving headroom under it, so a saturated backlog spends the whole
 *  budget and depends on the `rate-limited` early return below to stay correct
 *  at the boundary — and any other anonymous GitHub call sharing this egress
 *  IP can tip such a tick into 429s. Terminal-state exclusion and failure
 *  retirement drain the anonymous backlog over time; pod-lane records drain
 *  by resolving, by retiring, or with their agent (the skills cleanup saga
 *  deletes an agent's records). */
const MAX_ANON_READS_PER_TICK = 10;

/** The pod pass spends each owner's authenticated 5000/hour bucket, so this
 *  cap is about tick duration, not GitHub budget: every attempt is an RPC
 *  into a pod. Pull requests left unattempted keep their old `checkedAt` and
 *  therefore head the next tick's page. */
const MAX_POD_READS_PER_TICK = 25;

/** Page size for pod-lane candidates — a memory bound, not a schedule: the
 *  page is filtered to warm publishers before anything is attempted, and
 *  unattempted rows are reselected next tick. */
const POD_CANDIDATE_PAGE = 200;

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
  /** Ids of agents whose pods are running right now — the pod pass's warmth
   *  filter. One cluster call per tick, made only on ticks that actually have
   *  pod-lane candidates. */
  listRunningAgentIds: () => Promise<string[]>;
  log: (msg: string) => void;
}

export function createPrStateResolver(deps: ResolverDeps): PrStateResolver {
  return {
    async tick() {
      const now = new Date();
      // Anonymous first: a fresh 404 marks its record `pr_needs_pod`, and the
      // pod pass — running second — already picks it up in this same tick
      // when one of its publishers happens to be warm.
      let resolved = await anonymousPass(deps, now);
      resolved += await podPass(deps, now);
      return resolved;
    },
  };
}

async function anonymousPass(deps: ResolverDeps, now: Date): Promise<number> {
  // One extra so a full page is evidence of a backlog rather than a
  // coincidence, and the log can say so honestly.
  const candidates = await deps.agentSkills.listPrStateCandidates(
    now,
    MAX_ANON_READS_PER_TICK + 1,
  );
  const skipped = Math.max(0, candidates.length - MAX_ANON_READS_PER_TICK);
  if (skipped > 0) {
    deps.log(
      `anonymous backlog exceeds the per-tick cap; ${skipped}+ record(s) wait for the next tick`,
    );
  }

  let resolved = 0;
  for (const candidate of groupByPrUrl(
    candidates.slice(0, MAX_ANON_READS_PER_TICK),
  )) {
    const coords = parsePrUrl(candidate.prUrl);
    if (!coords) {
      // Not a GitHub pull request URL, so no amount of retrying helps.
      // Stamp it anyway so it backs off and eventually retires rather than
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
      await deps.agentSkills.touchPrState(candidate.prUrl, now, "confirmed");
      continue;
    }
    if (result.reason === "rate-limited") {
      // Stop this pass: every further anonymous read this window is certain
      // to fail, and attempting them would burn the next window too. The pod
      // pass still runs — it spends nothing anonymous.
      deps.log(
        `anonymous rate limit exhausted; ${resolved} record(s) resolved before stopping`,
      );
      return resolved;
    }
    // A 404 means "not resolvable anonymously" — private as much as gone.
    // Mark the record and leave it to the pod pass; no stamp, because no
    // verdict on the pull request was reached. Only `not-found`: an error or
    // a rate limit says nothing about the source being private.
    if (result.reason === "not-found") {
      await deps.agentSkills.markPrNeedsPod(candidate.prUrl);
      continue;
    }
    // Unavailable: keep whatever state is already known — a blip must not
    // erase a resolved `merged` — but discard the validator, which belongs
    // to a resource we could not read. Keeping it risks a later 304 that
    // would assert a cached state we may not have.
    await deps.agentSkills.touchPrState(candidate.prUrl, now, "failed");
  }
  return resolved;
}

async function podPass(deps: ResolverDeps, now: Date): Promise<number> {
  const candidates = await deps.agentSkills.listPodPrStateCandidates(
    now,
    POD_CANDIDATE_PAGE + 1,
  );
  if (candidates.length === 0) return 0;
  if (candidates.length > POD_CANDIDATE_PAGE) {
    deps.log(
      `pod-lane page is full; ${POD_CANDIDATE_PAGE}+ eligible record(s), the rest wait for the next tick`,
    );
  }

  const running = new Set(await deps.listRunningAgentIds());
  let resolved = 0;
  let attempted = 0;
  for (const candidate of groupByPrUrl(
    candidates.slice(0, POD_CANDIDATE_PAGE),
  )) {
    // Publishers all cold: skip without a stamp. No attempt happened and
    // nothing was learned, so neither the clock nor the failure count moves —
    // the record stays at the head of the page until a warm sample resolves
    // it, it retires, or it is deleted with its agent.
    const warmIds = candidate.agentIds.filter((id) => running.has(id));
    if (warmIds.length === 0) continue;

    if (attempted >= MAX_POD_READS_PER_TICK) {
      deps.log(
        `pod-lane cap reached; remaining warm record(s) wait for the next tick`,
      );
      break;
    }
    attempted += 1;

    const coords = parsePrUrl(candidate.prUrl);
    if (!coords) {
      // Unreachable through the normal flow — only a URL that parsed can
      // 404 its way into this lane — but a bad row must retire rather than
      // wedge the page.
      await deps.agentSkills.touchPrState(candidate.prUrl, now, "failed");
      continue;
    }

    resolved += await resolveThroughWarmPods(
      deps,
      candidate.prUrl,
      warmIds,
      coords,
      now,
    );
  }
  return resolved;
}

/** Try each warm publisher's pod until one answers. A warm pod that couldn't
 *  answer is a real failure; a pod that hibernated between the warmth check
 *  and the read reports `not-running` and is treated as cold — if nothing
 *  answered and nothing failed, the record is left unstamped for the next
 *  tick, exactly as if the warmth filter had caught it. */
async function resolveThroughWarmPods(
  deps: Pick<ResolverDeps, "agentSkills" | "podReader">,
  prUrl: string,
  agentIds: string[],
  coords: PrCoordinates,
  now: Date,
): Promise<number> {
  let sawWarmFailure = false;
  for (const agentId of agentIds) {
    const result = await deps.podReader.read(agentId, coords);
    if (result.kind === "state") {
      await deps.agentSkills.setPrState(prUrl, {
        prState: derivePrState(result.disposition),
        checkedAt: now,
        // The pod path reads no ETag back, and any anonymous validator is for
        // a resource the anonymous path cannot see.
        etag: null,
      });
      return 1;
    }
    if (result.kind === "failed") sawWarmFailure = true;
  }
  if (sawWarmFailure) {
    await deps.agentSkills.touchPrState(prUrl, now, "failed");
  }
  return 0;
}

/** Several agents can carry a record for the same pull request; read it once
 *  — keeping every publisher's agentId for the pod pass's warmth filter —
 *  and let the keyed-on-prUrl writes settle all of them. */
export function groupByPrUrl(
  candidates: (PrStateCandidate | PodPrStateCandidate)[],
): {
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
        prEtag: "prEtag" in c ? c.prEtag : null,
        agentIds: [c.agentId],
      });
    } else if (!group.agentIds.includes(c.agentId)) {
      group.agentIds.push(c.agentId);
    }
  }
  return [...byUrl.values()];
}
