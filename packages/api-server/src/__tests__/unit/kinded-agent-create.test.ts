import { describe, expect, it } from "vitest";
import type { Agent, AgentCreateInput } from "api-server-api";
import { createKindedAgent } from "../../modules/agents/services/kinded-agent-create.js";
import { buildExperimentInstallCommand } from "../../modules/experiments/domain/install-command.js";
import type { RuntimeMutator } from "../../modules/runtime-delivery/index.js";

function fakeAgent(id: string): Agent {
  return {
    id,
    name: "my-experiments",
    spec: { name: "my-experiments", image: "quay.io/example/claude-code" },
    state: "starting",
    effectiveHibernationTimeoutMin: 30,
    stopRequested: false,
    overBudget: false,
    contributionFailures: [],
    features: { liveUpdates: false },
    channels: [],
    kind: "experiment",
  };
}

function makeHarness() {
  const calls = {
    createInputs: [] as AgentCreateInput[],
    bumped: [] as { agentId: string; events: unknown[] }[],
    enqueued: [] as string[],
    woken: [] as string[],
    deleted: [] as string[],
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
  const deps = {
    owner: "user-1",
    surface: "ui",
    agents: {
      async create(input: AgentCreateInput) {
        calls.createInputs.push(input);
        return fakeAgent("agent-x1");
      },
      async delete(id: string) {
        calls.deleted.push(id);
      },
    },
    runtimeMutator,
    wakeAgent: async (agentId: string) => {
      calls.woken.push(agentId);
    },
    now: () => new Date("2026-07-28T00:00:00Z"),
  };
  return { deps, calls };
}

describe("createKindedAgent", () => {
  it("stamps the kind and passes the standard create choices through", async () => {
    const { deps, calls } = makeHarness();
    await createKindedAgent(deps, {
      createInput: {
        name: "my-experiments",
        templateId: "claude-code",
        egressPreset: "trusted",
        connectionIds: ["conn-1"],
        kind: "experiment",
      },
      installCommand: buildExperimentInstallCommand(),
      eventIdPrefix: "experiment-install",
      securityEvent: "experiment_sandbox.create",
    });
    expect(calls.createInputs).toHaveLength(1);
    expect(calls.createInputs[0]).toMatchObject({
      name: "my-experiments",
      templateId: "claude-code",
      egressPreset: "trusted",
      connectionIds: ["conn-1"],
      kind: "experiment",
    });
  });

  it("delivers the install command as a durable one-shot and wakes the agent", async () => {
    const { deps, calls } = makeHarness();
    const agent = await createKindedAgent(deps, {
      createInput: { name: "my-experiments", templateId: "claude-code" },
      installCommand: buildExperimentInstallCommand(),
      eventIdPrefix: "experiment-install",
      securityEvent: "experiment_sandbox.create",
    });
    expect(agent.id).toBe("agent-x1");

    expect(calls.bumped).toHaveLength(1);
    const { agentId, events } = calls.bumped[0]!;
    expect(agentId).toBe("agent-x1");
    expect(events).toHaveLength(1);
    const event = events[0] as {
      id: string;
      kind: string;
      expiresAt: Date;
      payload: { command: string };
    };
    expect(event.kind).toBe("workspace-command");
    expect(event.id).toContain("experiment-install:agent-x1:");
    expect(event.payload.command).toContain("dam-experiment");
    expect(event.expiresAt.getTime()).toBeGreaterThan(
      new Date("2026-08-20T00:00:00Z").getTime(),
    );

    expect(calls.enqueued).toEqual(["agent-x1"]);
    expect(calls.woken).toEqual(["agent-x1"]);
  });

  it("deletes the fresh agent when the install enqueue fails", async () => {
    const { deps, calls } = makeHarness();
    await expect(
      createKindedAgent(
        {
          ...deps,
          runtimeMutator: {
            async bump() {
              throw new Error("outbox unavailable");
            },
            async enqueueAfterCommit() {},
          },
        },
        {
          createInput: { name: "my-experiments", templateId: "claude-code" },
          installCommand: buildExperimentInstallCommand(),
          eventIdPrefix: "experiment-install",
          securityEvent: "experiment_sandbox.create",
        },
      ),
    ).rejects.toThrow("outbox unavailable");
    expect(calls.deleted).toEqual(["agent-x1"]);
    expect(calls.woken).toEqual([]);
  });

  it("wakes only after the install event is enqueued", async () => {
    const { deps, calls } = makeHarness();
    const order: string[] = [];
    await createKindedAgent(
      {
        ...deps,
        runtimeMutator: {
          async bump(agentId, events) {
            order.push("bump");
            calls.bumped.push({ agentId, events });
            return 1;
          },
          async enqueueAfterCommit() {
            order.push("enqueue");
          },
        },
        wakeAgent: async () => {
          order.push("wake");
        },
      },
      {
        createInput: { name: "my-experiments", templateId: "claude-code" },
        installCommand: buildExperimentInstallCommand(),
        eventIdPrefix: "experiment-install",
        securityEvent: "experiment_sandbox.create",
      },
    );
    expect(order).toEqual(["bump", "enqueue", "wake"]);
  });
});
