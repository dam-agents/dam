// TEST_OVERVIEW: a sub-agent's run can end on a question for its owner: asking ends the run and leaves the sub-agent to sleep; an answer, from the owner or the sub-agent's own default once nobody answered in time, starts the next run in the same session with the time that was left; only the first answer counts, and the default is taken once.
import { describe, expect, test, vi } from "vitest";

import { createOwnerQuestions } from "../../modules/invocations/services/owner-questions.js";
import { createQuestionDeadlines } from "../../modules/invocations/services/question-deadlines.js";
import type {
  InvocationRow,
  InvocationsRepository,
} from "../../modules/invocations/infrastructure/invocations-repository.js";
import {
  fakeInvocationsRepo,
  invocationRow,
} from "../helpers/invocations-repo.js";

const NOW = new Date("2026-11-11T10:00:00Z");
const QUESTION = {
  question: "Fix the helper, or change the tests?",
  options: ["Fix the helper", "Change the tests"],
  default: "fix the helper",
};

function setup(row: InvocationRow) {
  const runs = new Map([[row.runId!, row]]);
  const begun: Parameters<InvocationsRepository["answerQuestion"]>[1][] = [];
  const repo = fakeInvocationsRepo({
    getRun: async (id) => runs.get(id) ?? null,
    ask: async (runId, asked) => {
      const run = runs.get(runId);
      if (!run || run.status !== "running") return false;
      Object.assign(run, {
        status: "asking",
        question: asked.question,
        answerBy: asked.answerBy,
        sessionId: asked.sessionId,
      });
      return true;
    },
    answerQuestion: async (runId, next) => {
      const run = runs.get(runId);
      if (!run || run.status !== "asking") return "closed";
      run.status = "answered";
      begun.push(next);
      return "answered";
    },
    listAskingRuns: async (id) =>
      [...runs.values()].filter((r) => r.id === id && r.status === "asking"),
    listAskingDue: async (now) =>
      [...runs.values()].filter(
        (r) => r.status === "asking" && r.answerBy! <= now,
      ),
  });
  const bump = vi.fn(async () => 1);
  const enqueue = vi.fn(async () => {});
  const park = vi.fn(async () => {});
  const wakeAgent = vi.fn(async () => {});
  const questions = createOwnerQuestions({
    repo,
    runtimeMutator: { bump, enqueueAfterCommit: enqueue },
    wakeAgent,
    hold: {
      park,
      capture: { capture: async () => {} },
      answerWithinMaxMs: 7 * 86_400_000,
    },
    log: () => {},
    now: () => NOW,
  });
  return { repo, questions, begun, bump, enqueue, park, wakeAgent };
}

const running = (overrides: Partial<InvocationRow> = {}) =>
  invocationRow({
    id: "agent-t",
    runId: "invocation:agent-t:1",
    resultSchema: { type: "string" },
    expiresAt: new Date(NOW.getTime() + 20 * 60_000),
    ...overrides,
  });

const reporting = { run: "invocation:agent-t:1", sessionId: "sess-1" };

describe("a sub-agent's question to its owner", () => {
  test("asking ends the run, leaves the sub-agent to sleep, and waits an hour by default", async () => {
    const row = running();
    const { questions, park } = setup(row);

    const outcome = await questions.ask("agent-t", QUESTION, reporting);

    expect(outcome).toEqual({
      ok: true,
      answerBy: new Date(NOW.getTime() + 60 * 60_000),
    });
    expect(park).toHaveBeenCalledWith("agent-t");
    expect(row.status).toBe("asking");
    expect(row.question).toEqual({
      text: QUESTION.question,
      options: QUESTION.options,
      defaultOption: "Fix the helper",
      remainingMs: 20 * 60_000,
    });
  });

  test("a run a script started, and a default that is not an option, are refused and keep running", async () => {
    const scripted = running({ origin: "script" });
    expect(
      (await setup(scripted).questions.ask("agent-t", QUESTION, reporting)).ok,
    ).toBe(false);
    expect(scripted.status).toBe("running");

    const row = running();
    const refused = await setup(row).questions.ask(
      "agent-t",
      { ...QUESTION, default: "Something else" },
      reporting,
    );
    expect(refused).toMatchObject({ ok: false });
    expect(row.status).toBe("running");
  });

  test("an open question takes no options and any default; a single option is refused", async () => {
    const open = running();
    const asked = await setup(open).questions.ask(
      "agent-t",
      { question: "Which number from 1 to 10?", default: "7" },
      reporting,
    );
    expect(asked.ok).toBe(true);
    expect(open.question).toMatchObject({ options: [], defaultOption: "7" });

    const single = running();
    const refused = await setup(single).questions.ask(
      "agent-t",
      { question: "Go?", options: ["Yes"], default: "Yes" },
      reporting,
    );
    expect(refused.ok).toBe(false);
    expect(single.status).toBe("running");
  });

  test("an answer starts the next run in the same session with the time that was left, and only the first answer counts", async () => {
    const row = running();
    const { questions, begun, bump, enqueue, wakeAgent } = setup(row);
    await questions.ask("agent-t", QUESTION, reporting);

    expect(
      await questions.answer(row, { text: "Change the tests", by: "owner" }),
    ).toBe(true);
    expect(
      await questions.answer(row, { text: "Fix the helper", by: "default" }),
    ).toBe(false);

    expect(begun).toHaveLength(1);
    expect(begun[0]).toMatchObject({
      sessionId: "sess-1",
      ttlMs: 20 * 60_000,
      resultSchema: { type: "string" },
      answer: { text: "Change the tests", by: "owner" },
    });
    expect(bump).toHaveBeenCalledTimes(1);
    expect(bump.mock.calls[0]).toMatchObject([
      "agent-t",
      [
        {
          id: begun[0]!.runId,
          kind: "trigger",
          payload: { invocation: true, invocationSession: "sess-1" },
        },
      ],
    ]);
    expect(enqueue).toHaveBeenCalledWith("agent-t");
    expect(wakeAgent).toHaveBeenCalledWith("agent-t");
  });

  test("a question nobody answered in time takes the default, once", async () => {
    const row = running({ label: "fix-auth-tests" });
    const { repo, questions, begun } = setup(row);
    await questions.ask("agent-t", QUESTION, reporting);
    const deadlines = (at: Date) =>
      createQuestionDeadlines({
        repo,
        questions,
        batchSize: 10,
        now: () => at,
        log: () => {},
      })();

    expect(await deadlines(new Date(NOW.getTime() + 59 * 60_000))).toBe(0);
    expect(await deadlines(new Date(NOW.getTime() + 61 * 60_000))).toBe(1);
    expect(await deadlines(new Date(NOW.getTime() + 62 * 60_000))).toBe(0);

    expect(begun).toHaveLength(1);
    expect(begun[0]).toMatchObject({
      answer: { text: "Fix the helper", by: "default" },
    });
  });
});
