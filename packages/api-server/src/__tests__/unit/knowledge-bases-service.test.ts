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
    stopRequested: false,
    overBudget: false,
    contributionFailures: [],
    channels: [],
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
    surface: "ui",
    agents: {
      async create(input) {
        calls.createInputs.push(input);
        return fakeAgent("agent-kb1");
      },
      async delete() {},
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
      kbTemplateId: "llm-wiki",
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

  it("delivers the install command as a one-shot workspace-command and wakes the agent", async () => {
    const { service, calls } = makeHarness();
    const agent = await service.create({
      name: "my-kb",
      templateId: "claude-code",
      kbTemplateId: "llm-wiki",
    });
    expect(agent.id).toBe("agent-kb1");

    expect(calls.bumped).toHaveLength(1);
    const { agentId, events } = calls.bumped[0]!;
    expect(agentId).toBe("agent-kb1");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "workspace-command" });
    const command = (events[0] as { payload: { command: string } }).payload
      .command;
    expect(command).toContain("bootstrap.sh");
    expect(command).toContain("llm-wiki");

    expect(calls.enqueued).toEqual(["agent-kb1"]);
    expect(calls.woken).toEqual(["agent-kb1"]);
  });
});
