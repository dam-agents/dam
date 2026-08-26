import { describe, expect, it } from "vitest";

import {
  AgentWakeTimeoutError,
  type WakeFailureCause,
} from "../../modules/agents/index.js";
import { ARTIFACT_REQUEST_TTL_MS } from "../../modules/artifact-library/domain/artifact-request.js";
import { createArtifactRequestDelivery } from "../../modules/artifact-library/services/artifact-request-delivery.js";
import type { RuntimeMutator } from "../../modules/runtime-delivery/index.js";

// TEST_OVERVIEW: Delivery is the schedule-fire sequence with an artifact id in place of a schedule id: write an `artifact-request` event into the agent's outbox, poke the agent's state queue, then wake the agent. The event id is `artifact-request:<requestId>:<firedAt>` because the pod splits an event id into a key and a timestamp to decide whether it has already run that event. The event carries the same kind of TTL a trigger does, so a request nobody serves is dropped rather than served hours later. The wake is where the platform tells us what went wrong, and its typed cause is what the page renders: a missing agent is `agent_deleted`, no room to start is `over_budget`, and anything else is `wake_failed`.

interface Bumped {
  agentId: string;
  events: { id: string; kind: string; payload: unknown; expiresAt: Date }[];
}

function fakeRuntime(): RuntimeMutator & {
  bumped: Bumped[];
  enqueued: string[];
} {
  const bumped: Bumped[] = [];
  const enqueued: string[] = [];
  return {
    bumped,
    enqueued,
    bump: (agentId, events) => {
      bumped.push({ agentId, events: events as Bumped["events"] });
      return Promise.resolve(1);
    },
    enqueueAfterCommit: (agentId) => {
      enqueued.push(agentId);
      return Promise.resolve();
    },
  };
}

const input = {
  requestId: "req-1",
  artifactId: "art-1",
  agentId: "agent-1",
  task: "do the thing",
};

const silent = () => {};

describe("delivering an artifact request", () => {
  // TEST_SCENARIO: The event is what the pod reads to open or resume the page's session, so it must carry the request, the page and the prompt, and expire like a trigger does.
  it("writes the event, pokes the queue, then wakes the agent", async () => {
    const runtime = fakeRuntime();
    const woken: string[] = [];
    const now = new Date("2026-08-26T12:00:00.000Z");
    const delivery = createArtifactRequestDelivery({
      runtimeMutator: runtime,
      ensureAgentReady: (agentId) => {
        woken.push(agentId);
        return Promise.resolve();
      },
      now: () => now,
      log: silent,
    });

    await expect(delivery.deliver(input)).resolves.toEqual({ ok: true });
    expect(runtime.bumped).toEqual([
      {
        agentId: "agent-1",
        events: [
          {
            id: `artifact-request:req-1:${now.getTime()}`,
            kind: "artifact-request",
            payload: {
              requestId: "req-1",
              artifactId: "art-1",
              task: "do the thing",
            },
            expiresAt: new Date(now.getTime() + ARTIFACT_REQUEST_TTL_MS),
          },
        ],
      },
    ]);
    expect(runtime.enqueued).toEqual(["agent-1"]);
    expect(woken).toEqual(["agent-1"]);
  });

  // TEST_SCENARIO: The three wake outcomes the page renders differently. Each comes from the platform's own typed cause rather than from reading a message.
  it("maps the wake failure onto the reason the page renders", async () => {
    const cases: { failure: WakeFailureCause; reason: string }[] = [
      { failure: { kind: "not-found" }, reason: "agent_deleted" },
      {
        failure: { kind: "over-budget", message: "no room" },
        reason: "over_budget",
      },
      { failure: { kind: "gateway-not-ready" }, reason: "wake_failed" },
    ];
    for (const { failure, reason } of cases) {
      const delivery = createArtifactRequestDelivery({
        runtimeMutator: fakeRuntime(),
        ensureAgentReady: () =>
          Promise.reject(
            new AgentWakeTimeoutError({
              agentId: "agent-1",
              timeoutMs: 1_000,
              durationMs: 10,
              failure,
            }),
          ),
        log: silent,
      });
      await expect(delivery.deliver(input)).resolves.toEqual({
        ok: false,
        reason,
      });
    }
  });

  // TEST_SCENARIO: A wake that throws something the platform did not classify is still a wake that did not happen, and the page must hear a reason rather than wait for the TTL.
  it("reports an unclassified wake error as wake_failed", async () => {
    const delivery = createArtifactRequestDelivery({
      runtimeMutator: fakeRuntime(),
      ensureAgentReady: () => Promise.reject(new Error("connection reset")),
      log: silent,
    });
    await expect(delivery.deliver(input)).resolves.toEqual({
      ok: false,
      reason: "wake_failed",
    });
  });

  // TEST_SCENARIO: If the event never reaches the outbox there is nothing for the agent to serve, so the request fails now instead of looking delivered.
  it("reports a queue write that failed", async () => {
    const runtime = fakeRuntime();
    const delivery = createArtifactRequestDelivery({
      runtimeMutator: {
        ...runtime,
        bump: () => Promise.reject(new Error("db down")),
      },
      ensureAgentReady: () => Promise.resolve(),
      log: silent,
    });
    await expect(delivery.deliver(input)).resolves.toEqual({
      ok: false,
      reason: "wake_failed",
    });
  });
});
