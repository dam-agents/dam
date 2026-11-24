import type { SessionPair } from "api-server-api";
import type { Db } from "db";

import type { RuntimeMutator } from "../runtime-delivery/index.js";
import type { SpendHoldGate } from "../spend/index.js";
import type { CostReviewFloors } from "./domain/offers.js";
import { createCostReviewsRepository } from "./infrastructure/cost-reviews-repository.js";
import {
  createCostReviewSupportReader,
  createOfferCandidatesReader,
  type OwnedAgent,
} from "./infrastructure/offer-candidates.js";
import {
  createCostReviews,
  type CostReviews,
} from "./services/cost-reviews-service.js";

const MICROS = 1_000_000;

export interface CostReviewFloorsConfig {
  minWeeklyUsd: number;
  minWeeklyBobcoins: number;
}

export function composeCostReviewsForOwner(deps: {
  db: Db;
  owner: string;
  floors: CostReviewFloorsConfig;
  ownedAgents: () => Promise<OwnedAgent[]>;
  spendHold: SpendHoldGate;
  sessionPair: (agentId: string) => Promise<SessionPair | null | undefined>;
  runtimeMutator: Pick<RuntimeMutator, "bump" | "enqueueAfterCommit">;
  wakeAgent: (agentId: string) => Promise<void>;
}): CostReviews {
  const floors: CostReviewFloors = {
    paidUsdMicros: deps.floors.minWeeklyUsd * MICROS,
    bobcoinMicros: deps.floors.minWeeklyBobcoins * MICROS,
  };
  return createCostReviews({
    owner: deps.owner,
    repo: createCostReviewsRepository(deps.db),
    ownedAgents: deps.ownedAgents,
    candidates: createOfferCandidatesReader(deps.db),
    floors,
    supportsReview: createCostReviewSupportReader(deps.db),
    spendHold: deps.spendHold,
    sessionPair: deps.sessionPair,
    runtimeMutator: deps.runtimeMutator,
    wakeAgent: deps.wakeAgent,
  });
}

export function createCostReviewsCleanup(db: Db): {
  listAgentIds(): Promise<string[]>;
  cleanup(agentId: string): Promise<void>;
} {
  const repo = createCostReviewsRepository(db);
  return {
    listAgentIds: () => repo.listAgentIds(),
    cleanup: (agentId) => repo.deleteForAgent(agentId),
  };
}
