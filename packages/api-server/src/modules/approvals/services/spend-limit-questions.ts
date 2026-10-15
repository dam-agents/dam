import type { ApprovalsRepository } from "../infrastructure/approvals-repository.js";
import { getLogger } from "../../../core/logger.js";
import { formatError } from "../../../core/format-error.js";
import { emit, EventType } from "../../../events.js";
import type { SpendLimitQuestion } from "../../spend/index.js";

export interface SpendLimitQuestions {
  ask(input: {
    agentId: string;
    ownerSub: string;
    questions: readonly SpendLimitQuestion[];
  }): Promise<void>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function spendLimitApprovalId(question: SpendLimitQuestion): string {
  return `spendlimit:${question.limitId}:${question.day}:${String(question.extensions)}`;
}

export function createSpendLimitQuestions(deps: {
  repo: ApprovalsRepository;
}): SpendLimitQuestions {
  return {
    async ask({ agentId, ownerSub, questions }) {
      for (const question of questions) {
        const id = spendLimitApprovalId(question);
        const asked = await deps.repo
          .insertIfAbsent({
            id,
            type: "spend_limit",
            agentId,
            ownerSub,
            sessionId: null,
            payload: { kind: "spend_limit", ...question },
            expiresAt: new Date(
              Date.parse(`${question.day}T00:00:00Z`) + DAY_MS,
            ),
          })
          .catch((err: unknown) => {
            getLogger().error(
              { approvalId: id, reason: formatError(err) },
              "spend.question_not_asked",
            );
            return false;
          });
        if (asked) {
          emit({
            type: EventType.ApprovalRequested,
            approvalId: id,
            agentId,
            ownerSub,
          });
        }
      }
    },
  };
}
