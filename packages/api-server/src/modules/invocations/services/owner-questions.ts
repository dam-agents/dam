import type { DelegationAnswer, OwnerQuestionInput } from "api-server-api";
import { emit, EventType } from "../../../events.js";
import type { RuntimeMutator } from "../../runtime-delivery/index.js";
import { buildInvocationPrompt } from "../domain/invocation-prompt.js";
import {
  answerDeadline,
  answerTask,
  askedQuestion,
  MIN_CONTINUE_MS,
} from "../domain/owner-question.js";
import { invocationScheduleId, runEventId } from "../domain/target-name.js";
import type {
  InvocationRow,
  InvocationsRepository,
} from "../infrastructure/invocations-repository.js";
import type { TargetCapture } from "./target-capture.js";

export type AskOutcome =
  { ok: true; answerBy: Date } | { ok: false; errors: string };

export interface OwnerQuestions {
  // UNIT_BOUNDARY_DESCRIPTION: ends the reporting session's run on a question for the sub-agent's owner and leaves the sub-agent to sleep until the answer; refused for a run that is not running, a script, a run a script started, and a run whose session is not known, each with what the sub-agent should do instead.
  ask(
    invocationId: string,
    input: OwnerQuestionInput,
    reporting: { run: string; sessionId: string | null } | null,
  ): Promise<AskOutcome>;
  // UNIT_BOUNDARY_DESCRIPTION: answers the question a sub-agent waits on and starts the run that continues its work in the same session, with the time its run had left; false when the question was answered already or the sub-agent is gone.
  answer(
    asking: InvocationRow,
    answer: Pick<DelegationAnswer, "text" | "by">,
  ): Promise<boolean>;
  // UNIT_BOUNDARY_DESCRIPTION: the question a sub-agent waits on, if it waits on one.
  waitingOf(invocationId: string): Promise<InvocationRow | null>;
}

const SCRIPT_DRIVEN =
  "this run was started by a script, which only waits for a result and tells nobody of a question. Make the reasonable call yourself and go on";

/**
 * UNIT_BOUNDARY_DESCRIPTION: a sub-agent's question to its owner. Asking ends
 * the run: the sub-agent stops holding its driver awake and its time limit
 * stops running, and it stays, asleep, exempt from every reap, until the
 * question is answered or its target is stopped. An answer, the owner's or
 * the default at the deadline, starts a new run in the same session, so the sub-agent goes on with its
 * conversation and its files.
 */
export function createOwnerQuestions(deps: {
  repo: Pick<
    InvocationsRepository,
    "get" | "getRun" | "ask" | "answerQuestion" | "listAskingRuns"
  >;
  runtimeMutator: Pick<RuntimeMutator, "bump" | "enqueueAfterCommit">;
  wakeAgent: (agentId: string) => Promise<void>;
  // UNIT_BOUNDARY_DESCRIPTION: what taking a question needs, which only the surface a sub-agent asks through has: `park` makes the sub-agent one that sleeps and stays (the Agent Sweep no longer takes it asleep, and it sleeps soon after it goes idle), and the conversation so far is copied for its owner to read while it waits.
  hold?: {
    park: (agentId: string) => Promise<void>;
    capture: TargetCapture;
    answerWithinMaxMs: number;
  };
  log: (msg: string) => void;
  now?: () => Date;
}): OwnerQuestions {
  const now = deps.now ?? (() => new Date());

  // UNIT_BOUNDARY_DESCRIPTION: a question asked or answered changes what its owner is told needs them, so their open pages read it again at once.
  function attentionChanged(row: InvocationRow): void {
    emit({
      type: EventType.AttentionChanged,
      ownerSub: row.owner,
      agentId: row.rootDriverId,
    });
  }

  async function askingRun(
    invocationId: string,
    reporting: { run: string; sessionId: string | null } | null,
  ): Promise<InvocationRow | null> {
    if (!reporting?.run) return deps.repo.get(invocationId);
    const named = await deps.repo.getRun(reporting.run);
    if (named) return named;
    const latest = await deps.repo.get(invocationId);
    return latest?.runId === invocationId ? latest : null;
  }

  return {
    async ask(invocationId, input, reporting) {
      const { hold } = deps;
      if (!hold) return { ok: false, errors: "questions are not taken here" };
      const row = await askingRun(invocationId, reporting);
      if (!row || row.id !== invocationId || !row.runId)
        return {
          ok: false,
          errors:
            "only a sub-agent's run can ask its owner this way. Ask in your reply instead",
        };
      if (row.status !== "running")
        return {
          ok: false,
          errors: `this run is already ${row.status}; end your turn now`,
        };
      if (row.script !== null || row.origin !== "tool")
        return { ok: false, errors: SCRIPT_DRIVEN };
      const sessionId = reporting?.sessionId ?? row.sessionId;
      if (!sessionId)
        return {
          ok: false,
          errors:
            "the platform cannot tell which conversation to continue with the answer. Make the reasonable call yourself and go on",
        };
      const question = askedQuestion(input);
      if ("error" in question) return { ok: false, errors: question.error };

      const at = now();
      const answerBy = answerDeadline(
        at,
        input.answerWithinMinutes,
        hold.answerWithinMaxMs,
      );
      try {
        await hold.park(invocationId);
      } catch (err) {
        deps.log(
          `[invocations] ${invocationId} could not be left to wait for an answer: ${String(err)}`,
        );
        return {
          ok: false,
          errors:
            "the platform could not hold this sub-agent for an answer. Make the reasonable call yourself and go on",
        };
      }
      const asked = await deps.repo.ask(row.runId, {
        question: {
          ...question,
          remainingMs: Math.max(row.expiresAt.getTime() - at.getTime(), 0),
        },
        answerBy,
        sessionId,
      });
      if (!asked)
        return {
          ok: false,
          errors: "this run is no longer running; end your turn now",
        };
      void hold.capture.capture({ id: invocationId });
      attentionChanged(row);
      return { ok: true, answerBy };
    },

    async answer(asking, answer) {
      const { question, answerBy, runId, sessionId } = asking;
      if (!question || !answerBy || !runId || !sessionId) return false;
      const at = now();
      const next = runEventId(asking.id, at);
      const limit = Math.max(question.remainingMs, MIN_CONTINUE_MS);
      const expiresAt = new Date(at.getTime() + limit);
      const prompt = answerTask(question.text, answer, answerBy);
      const outcome = await deps.repo.answerQuestion(runId, {
        runId: next,
        prompt,
        script: null,
        resultSchema: asking.resultSchema,
        ttlMs: limit,
        expiresAt,
        origin: asking.origin,
        driverSessionId: asking.driverSessionId,
        sessionId,
        answer: {
          question: question.text,
          text: answer.text,
          by: answer.by,
          at: at.toISOString(),
          answerBy: answerBy.toISOString(),
        },
      });
      if (outcome !== "answered") return false;
      attentionChanged(asking);
      await deps.runtimeMutator.bump(asking.id, [
        {
          id: next,
          kind: "trigger",
          payload: {
            scheduleId: invocationScheduleId(asking.id),
            task: buildInvocationPrompt({
              prompt,
              resultSchema: asking.resultSchema,
              canAsk: true,
            }),
            sessionMode: "fresh",
            invocation: true,
            invocationSession: sessionId,
          },
          expiresAt: new Date(expiresAt.getTime() + limit),
        },
      ]);
      await deps.runtimeMutator
        .enqueueAfterCommit(asking.id)
        .catch((err: unknown) => {
          deps.log(
            `[invocations] ${asking.id}'s answer was not pushed; the outbox sweep will carry it: ${String(err)}`,
          );
        });
      await deps.wakeAgent(asking.id).catch((err: unknown) => {
        deps.log(
          `[invocations] ${asking.id} did not wake for its answer: ${String(err)}`,
        );
      });
      return true;
    },

    async waitingOf(invocationId) {
      const asking = await deps.repo.listAskingRuns(invocationId);
      return asking[0] ?? null;
    },
  };
}
