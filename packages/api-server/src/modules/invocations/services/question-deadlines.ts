import type { InvocationsRepository } from "../infrastructure/invocations-repository.js";
import type { OwnerQuestions } from "./owner-questions.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: a question nobody answered by its deadline is
 * answered with the sub-agent's own default, so no sub-agent waits forever on
 * an owner who is away. The answer is the one write that counts, so a tick
 * that loses to an owner's late answer changes nothing. Nobody is told in a
 * turn: the sub-agent's card says what it chose.
 */
export function createQuestionDeadlines(deps: {
  repo: Pick<InvocationsRepository, "listAskingDue">;
  questions: Pick<OwnerQuestions, "answer">;
  batchSize: number;
  log: (msg: string) => void;
  now?: () => Date;
}): () => Promise<number> {
  const now = deps.now ?? (() => new Date());
  return async () => {
    let answered = 0;
    for (const row of await deps.repo.listAskingDue(now(), deps.batchSize)) {
      try {
        const taken = await deps.questions.answer(row, {
          text: row.question?.defaultOption ?? "",
          by: "default",
        });
        if (taken) answered++;
      } catch (err) {
        deps.log(
          `[sub-agents] the default for ${row.id}'s question was not taken: ${String(err)}`,
        );
      }
    }
    return answered;
  };
}
