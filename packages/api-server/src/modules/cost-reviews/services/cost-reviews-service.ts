import { TRPCError } from "@trpc/server";
import type {
  CostReviewOffer,
  CostReviewsService,
  SessionPair,
} from "api-server-api";

import { securityLog } from "../../../core/security-log.js";
import { emit, EventType } from "../../../events.js";
import {
  costReviewEvent,
  type RuntimeMutator,
} from "../../runtime-delivery/index.js";
import type { SpendHoldGate } from "../../spend/index.js";
import {
  COST_REVIEW_SESSION_TITLE,
  composeCostReviewPrompt,
} from "../domain/cost-review-prompt.js";
import {
  costReviewOffersOf,
  laterSince,
  type CostReviewFloors,
  type OfferCandidate,
} from "../domain/offers.js";
import type { CostReviewsRepository } from "../infrastructure/cost-reviews-repository.js";
import type { OwnedAgent } from "../infrastructure/offer-candidates.js";

const HOLD_MESSAGE = {
  limit:
    "This agent reached its spend limit for today, so the cost review cannot start. Raise or continue the limit, or try again tomorrow.",
  ceiling:
    "The spend ceiling for today is reached, so the cost review cannot start. Try again tomorrow.",
} as const;

export interface CostReviewsDeps {
  owner: string;
  repo: CostReviewsRepository;
  ownedAgents: () => Promise<OwnedAgent[]>;
  candidates: (
    ownerSub: string,
    open: readonly OwnedAgent[],
    now: Date,
  ) => Promise<OfferCandidate[]>;
  floors: CostReviewFloors;
  supportsReview: (agentId: string) => Promise<boolean>;
  spendHold: SpendHoldGate;
  sessionPair: (agentId: string) => Promise<SessionPair | null | undefined>;
  runtimeMutator: Pick<RuntimeMutator, "bump" | "enqueueAfterCommit">;
  wakeAgent: (agentId: string) => Promise<void>;
  interactiveReports: () => Promise<boolean>;
  now?: () => Date;
}

export interface CostReviews extends CostReviewsService {
  offers(): Promise<CostReviewOffer[]>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the platform's offer of a cost review, for one
 * owner. The offer is computed on read. Accepting it opens a regular chat
 * Session on the Agent's chat default whose first turn asks for the review,
 * and the offer never comes back for that Agent. "Later" hides it for
 * COST_REVIEW_LATER_DAYS, after which it returns if the Agent still qualifies. A review
 * only ever starts when the owner accepts, never on its own.
 */
export function createCostReviews(deps: CostReviewsDeps): CostReviews {
  const now = deps.now ?? (() => new Date());

  async function ownedIds(agentIds: readonly string[]): Promise<string[]> {
    const owned = new Set((await deps.ownedAgents()).map((a) => a.id));
    return agentIds.filter((id) => owned.has(id));
  }

  return {
    async offers() {
      const owned = await deps.ownedAgents();
      const at = now();
      const closed = await deps.repo.closed(
        owned.map((a) => a.id),
        laterSince(at),
      );
      const candidates = await deps.candidates(
        deps.owner,
        owned.filter((a) => !closed.has(a.id)),
        at,
      );
      return costReviewOffersOf(candidates, deps.floors, at);
    },

    async start(agentId) {
      if ((await ownedIds([agentId])).length === 0)
        throw new TRPCError({ code: "NOT_FOUND" });
      if (await deps.repo.accepted(agentId))
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "This agent's cost review already started. Ask the agent for another one in its chat.",
        });
      if (!(await deps.supportsReview(agentId)))
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "This agent's image cannot run a cost review yet. It gets it when the agent next starts on a newer image.",
        });
      const pair = await deps.sessionPair(agentId);
      const hold = await deps.spendHold({
        agentId,
        ...(pair?.provider && { connectionId: pair.provider }),
      });
      if (hold)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: HOLD_MESSAGE[hold],
        });
      const at = now();
      if (!(await deps.repo.accept(agentId, at)))
        throw new TRPCError({
          code: "CONFLICT",
          message: "This agent's cost review already started.",
        });
      try {
        await deps.runtimeMutator.bump(agentId, [
          costReviewEvent(
            agentId,
            composeCostReviewPrompt(await deps.interactiveReports()),
            COST_REVIEW_SESSION_TITLE,
            at,
            pair,
          ),
        ]);
      } catch (err) {
        await deps.repo.deleteForAgent(agentId);
        throw err;
      }
      try {
        await deps.runtimeMutator.enqueueAfterCommit(agentId);
        await deps.wakeAgent(agentId);
      } catch (err) {
        process.stderr.write(
          `[cost-reviews] ${agentId}: review accepted, delivery left to the outbox sweep: ${(err as Error).message}\n`,
        );
      }
      emit({
        type: EventType.CostReviewStarted,
        agentId,
        ownerSub: deps.owner,
      });
      emit({ type: EventType.AttentionChanged, agentId, ownerSub: deps.owner });
      securityLog("info", "cost_review.started", {
        category: "resource",
        actor: deps.owner,
        actorKind: "user",
        agentId,
        result: "success",
      });
      return { agentId, startedAt: at.toISOString() };
    },

    async dismiss(agentIds) {
      const owned = await ownedIds(agentIds);
      const recorded = await deps.repo.dismiss(owned, now());
      for (const agentId of recorded) {
        emit({
          type: EventType.CostReviewDismissed,
          agentId,
          ownerSub: deps.owner,
        });
        emit({
          type: EventType.AttentionChanged,
          agentId,
          ownerSub: deps.owner,
        });
      }
    },
  };
}
