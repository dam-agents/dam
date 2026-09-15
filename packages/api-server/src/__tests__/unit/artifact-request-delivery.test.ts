import { describe, expect, it } from "vitest";

import {
  AgentWakeTimeoutError,
  type WakeFailureCause,
} from "../../modules/agents/index.js";
import { ARTIFACT_REQUEST_TTL_MS } from "../../modules/artifact-library/domain/artifact-request.js";
import { createArtifactRequestDelivery } from "../../modules/artifact-library/services/artifact-request-delivery.js";
import type { RuntimeMutator } from "../../modules/runtime-delivery/index.js";

// TEST_OVERVIEW: Delivery is the schedule-fire sequence with an artifact id in place of a schedule id: write an `artifact-request` event into the agent's outbox, poke the agent's state queue, then wake the agent. The event id is `artifact-request:<requestId>:<firedAt>` because the pod splits an event id into a key and a timestamp to decide whether it has already run that event. The event carries the same kind of TTL a trigger does, so a request nobody serves is dropped rather than served hours later, and it names the conversation the page is bound to. The wake is where the platform tells us what went wrong, and its typed cause is what the page renders: a missing agent is `agent_deleted`, no room to start is `over_budget`, and anything else is `wake_failed`. Before any of that, a bound page's conversation has to still exist: deleting one only writes a tombstone the pod keeps out of its session list, so the check is a wake plus that list, and a pinned id missing from it settles the request `session_deleted` with nothing left in the outbox.

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
  sessionId: "sess-7",
  task: "do the thing",
};

const silent = () => {};

const noSessions = () => Promise.resolve([]);

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
      listSessions: noSessions,
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
              sessionId: "sess-7",
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
        listSessions: noSessions,
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
      listSessions: noSessions,
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
      listSessions: noSessions,
      log: silent,
    });
    await expect(delivery.deliver(input)).resolves.toEqual({
      ok: false,
      reason: "wake_failed",
    });
  });
});

describe("checking the conversation a page is bound to", () => {
  const bound = {
    requestId: "req-1",
    agentId: "agent-1",
    sessionId: "sess-7",
  };

  // TEST_SCENARIO: The pod filters tombstoned sessions out of the list it serves, so a pinned id that is still listed is a conversation the person still has.
  it("passes when the conversation is still listed", async () => {
    const delivery = createArtifactRequestDelivery({
      runtimeMutator: fakeRuntime(),
      ensureAgentReady: () => Promise.resolve(),
      listSessions: () =>
        Promise.resolve([{ sessionId: "sess-1" }, { sessionId: "sess-7" }]),
      log: silent,
    });
    await expect(delivery.checkBinding(bound)).resolves.toEqual({ ok: true });
  });

  // TEST_SCENARIO: Deleting a conversation writes a tombstone and nothing else — `session/resume` never consults it — so without this check a page would go on driving a conversation the person believes they deleted.
  it("settles session_deleted when the conversation is gone", async () => {
    const delivery = createArtifactRequestDelivery({
      runtimeMutator: fakeRuntime(),
      ensureAgentReady: () => Promise.resolve(),
      listSessions: () => Promise.resolve([{ sessionId: "sess-1" }]),
      log: silent,
    });
    await expect(delivery.checkBinding(bound)).resolves.toEqual({
      ok: false,
      reason: "session_deleted",
    });
  });

  // TEST_SCENARIO: The list lives in the pod, so reading it needs the agent up. A wake that fails is reported as itself, never as a deleted conversation.
  it("reports the wake failure rather than guessing the conversation is gone", async () => {
    const delivery = createArtifactRequestDelivery({
      runtimeMutator: fakeRuntime(),
      ensureAgentReady: () =>
        Promise.reject(
          new AgentWakeTimeoutError({
            agentId: "agent-1",
            timeoutMs: 1_000,
            durationMs: 10,
            failure: { kind: "not-found" },
          }),
        ),
      listSessions: () => Promise.reject(new Error("never reached")),
      log: silent,
    });
    await expect(delivery.checkBinding(bound)).resolves.toEqual({
      ok: false,
      reason: "agent_deleted",
    });
  });

  // TEST_SCENARIO: An agent that is up but whose session list cannot be read tells us nothing about the conversation, so the page hears that the agent could not be reached instead of that its conversation is gone.
  it("reports an unreadable session list as wake_failed", async () => {
    const delivery = createArtifactRequestDelivery({
      runtimeMutator: fakeRuntime(),
      ensureAgentReady: () => Promise.resolve(),
      listSessions: () => Promise.reject(new Error("socket closed")),
      log: silent,
    });
    await expect(delivery.checkBinding(bound)).resolves.toEqual({
      ok: false,
      reason: "wake_failed",
    });
  });
});
