import type {
  AgentSkillsRepository,
  PrStateCandidate,
} from "../infrastructure/agent-skills-repository.js";
import type { PrStateReader } from "../infrastructure/pr-state-reader.js";
import { derivePrState, type PodPrStateReader } from "../domain/pr-state.js";
import type { PrCoordinates } from "../domain/pr-url.js";
import { parsePrUrl } from "../domain/pr-url.js";

const MAX_READS_PER_TICK = 10;

export interface PrStateResolver {
  tick(): Promise<number>;
}

interface ResolverDeps {
  agentSkills: AgentSkillsRepository;
  reader: PrStateReader;
  podReader: PodPrStateReader;
  log: (msg: string) => void;
}

export function createPrStateResolver(deps: ResolverDeps): PrStateResolver {
  return {
    async tick() {
      const now = new Date();
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
          deps.log(
            `anonymous rate limit exhausted; ${resolved} record(s) resolved before stopping`,
          );
          return resolved;
        }
        if (result.reason === "not-found") {
          resolved += await resolveThroughPods(deps, candidate, coords, now);
          continue;
        }
        await deps.agentSkills.touchPrState(candidate.prUrl, now);
      }
      return resolved;
    },
  };
}

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
        etag: null,
      });
      return 1;
    }
  }
  await deps.agentSkills.touchPrState(candidate.prUrl, now);
  return 0;
}

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
