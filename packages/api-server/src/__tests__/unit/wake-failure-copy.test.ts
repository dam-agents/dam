// TEST_OVERVIEW: the sentence a person reads in chat when their agent will not start. The refusal the controller sends already names what is full and what to stop, so the copy has to carry it verbatim and end the sentence — appending a second remedy reads as a run-on and repeats the advice.
import { describe, expect, it } from "vitest";

import { classifyWakeFailure } from "../../modules/agents/domain/wake-failure.js";
import { wakeFailureUserCopy } from "../../modules/channels/infrastructure/wake-failure-copy.js";

const notReady = { ready: false, hibernated: false } as const;

describe("wakeFailureUserCopy for a refusal", () => {
  it("carries the VM runner's own refusal as the whole explanation", () => {
    const copy = wakeFailureUserCopy(
      classifyWakeFailure({
        ...notReady,
        overBudget: true,
        overBudgetMessage:
          "this machine's 2048 MiB does not fit: the VM runner has 512 MiB for machines and 1536 MiB is already committed; stop another agent or give the runner more memory",
      }),
    );
    expect(copy).toBe(
      "This agent can't start right now: this machine's 2048 MiB does not fit: " +
        "the VM runner has 512 MiB for machines and 1536 MiB is already committed; " +
        "stop another agent or give the runner more memory.",
    );
  });

  it("carries the budget ceiling the same way", () => {
    const copy = wakeFailureUserCopy(
      classifyWakeFailure({
        ...notReady,
        overBudget: true,
        overBudgetMessage:
          "starting this agent would take your running agents to 2/2 CPU and 4Gi/4Gi memory — stop a running agent to free room",
      }),
    );
    expect(copy).toBe(
      "This agent can't start right now: starting this agent would take your " +
        "running agents to 2/2 CPU and 4Gi/4Gi memory — stop a running agent to free room.",
    );
  });

  it("still says something actionable when the condition carried no message", () => {
    const copy = wakeFailureUserCopy(
      classifyWakeFailure({ ...notReady, overBudget: true }),
    );
    expect(copy).toBe(
      "This agent can't start right now: starting this agent would exceed your " +
        "compute budget — stop a running agent to free room.",
    );
  });
});
