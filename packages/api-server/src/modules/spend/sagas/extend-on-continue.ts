import { concatMap, type Subscription } from "rxjs";
import { filter } from "rxjs/operators";
import type { SpendLimitPayload } from "api-server-api";
import { formatError } from "../../../core/format-error.js";
import { getLogger } from "../../../core/logger.js";
import {
  emit,
  events$,
  EventType,
  ofType,
  type ApprovalResolved,
} from "../../../events.js";
import type { SpendLimits } from "../infrastructure/spend-limits.js";

export interface SpendQuestions {
  read(approvalId: string): Promise<SpendLimitPayload | null>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: "Continue" on a spend-limit question is any
 * allow verdict on a `spend_limit` approval. It raises that limit's Extension
 * for the question's UTC day to the count the question was asked at plus one,
 * so a $10 limit becomes $20 for today. The write keeps the higher count, so a
 * repeated event or a late answer to an older question never adds twice.
 */
export function startExtendOnContinueSaga(deps: {
  questions: SpendQuestions;
  limits: SpendLimits;
}): Subscription {
  return events$()
    .pipe(
      ofType<ApprovalResolved>(EventType.ApprovalResolved),
      filter(
        (event) =>
          event.resolution === "allow" || event.resolution === "allow_once",
      ),
      concatMap(async (event) => {
        try {
          const question = await deps.questions.read(event.approvalId);
          if (!question) return;
          await deps.limits.extend(
            question.limitId,
            question.day,
            question.extensions + 1,
          );
          emit({
            type: EventType.SpendLimitsChanged,
            ownerSub: event.ownerSub,
          });
        } catch (err) {
          getLogger().error(
            { approvalId: event.approvalId, reason: formatError(err) },
            "spend.extension_failed",
          );
        }
      }),
    )
    .subscribe();
}
