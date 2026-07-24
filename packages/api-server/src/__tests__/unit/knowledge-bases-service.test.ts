import { describe, expect, it } from "vitest";
import type { Agent, AgentCreateInput } from "api-server-api";
import { createKnowledgeBasesService } from "../../modules/knowledge-bases/services/knowledge-bases-service.js";
import type { RuntimeMutator } from "../../modules/runtime-delivery/index.js";

function fakeAgent(id: string): Agent {
  return {
    id,
    name: "my-kb",
    spec: { name: "my-kb", image: "quay.io/example/claude-code:latest" },
    state: "starting",
    effectiveHibernationTimeoutMin: 30,
    overBudget: false,
    contributionFailures: [],
    channels: [],
    allowedUserEmails: [],
    kind: "knowledge-base",
  };
}

function makeHarness() {
  const calls = {
    createInputs: [] as AgentCreateInput[],
    bumped: [] as { agentId: string; events: unknown[] }[],
    enqueued: [] as string[],
    woken: [] as string[],
  };
  const runtimeMutator: RuntimeMutator = {
    async bump(agentId, events) {
      calls.bumped.push({ agentId, events });
      return 1;
    },
    async enqueueAfterCommit(agentId) {
      calls.enqueued.push(agentId);
    },
  };
  const service = createKnowledgeBasesService({
    owner: "user-1",
    agents: {
      async create(input) {
        calls.createInputs.push(input);
        return fakeAgent("agent-kb1");
      },
    },
    runtimeMutator,
    wakeAgent: async (agentId) => {
      calls.woken.push(agentId);
    },
    now: () => new Date("2026-07-24T00:00:00Z"),
  });
  return { service, calls };
}

describe("knowledge-bases service", () => {
  it("creates the agent with the knowledge-base kind, passing the input through", async () => {
    const { service, calls } = makeHarness();
    await service.create({
      name: "my-kb",
      templateId: "claude-code",
      egressPreset: "trusted",
      connectionIds: ["conn-1"],
    });
    expect(calls.createInputs).toHaveLength(1);
    expect(calls.createInputs[0]).toMatchObject({
      name: "my-kb",
      templateId: "claude-code",
      egressPreset: "trusted",
      connectionIds: ["conn-1"],
      kind: "knowledge-base",
    });
  });

  it("delivers the install instruction as a one-shot trigger and wakes the agent", async () => {
    const { service, calls } = makeHarness();
    const agent = await service.create({
      name: "my-kb",
      templateId: "claude-code",
    });
    expect(agent.id).toBe("agent-kb1");

    expect(calls.bumped).toHaveLength(1);
    const { agentId, events } = calls.bumped[0]!;
    expect(agentId).toBe("agent-kb1");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "trigger",
      payload: {
        scheduleId: "kb-install:agent-kb1",
        sessionMode: "fresh",
        // The install run continues into the onboarding interview, so the
        // session must land under Chats where the user can answer.
        sessionType: "regular",
      },
    });
    const task = (events[0] as { payload: { task: string } }).payload.task;
    expect(task).toContain("INSTALLATION.md");
    expect(task).toContain("llm-wiki");

    expect(calls.enqueued).toEqual(["agent-kb1"]);
    expect(calls.woken).toEqual(["agent-kb1"]);
  });
});
