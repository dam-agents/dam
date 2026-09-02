import { describe, expect, it } from "vitest";
import type { Agent, AgentCreateInput, TemplateSpec } from "api-server-api";
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
    features: { liveUpdates: false },
    channels: [],
    kind: "knowledge-base",
  };
}

function templateSpec(harness?: string): TemplateSpec {
  return {
    version: "agent-platform.ai/v1",
    image: "quay.io/example/harness:latest",
    ...(harness ? { harness } : {}),
  };
}

function makeHarness(templates: Record<string, TemplateSpec> = {}) {
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
    readTemplateSpec: async (id) => {
      const spec = templates[id];
      return spec ? { spec, isOwned: false } : null;
    },
    runtimeMutator,
    wakeAgent: async (agentId) => {
      calls.woken.push(agentId);
    },
    now: () => new Date("2026-07-24T00:00:00Z"),
  });
  return { service, calls };
}

const CLAUDE_TEMPLATES = { "claude-code": templateSpec("claude-code") };

describe("knowledge-bases service", () => {
  it("creates the agent with the knowledge-base kind, passing the input through", async () => {
    const { service, calls } = makeHarness(CLAUDE_TEMPLATES);
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
    const { service, calls } = makeHarness(CLAUDE_TEMPLATES);
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

  // TEST_SCENARIO: the chosen template's harness family reaches the llm-wiki
  // TEST_SCENARIO: bootstrap as LLM_WIKI_HARNESS, so its tooling lands where that harness
  // TEST_SCENARIO: reads it; a template without a family (custom image, the e2e mock harness)
  // TEST_SCENARIO: leaves the bootstrap to detect the harness itself.
  it("passes the template's harness family to the llm-wiki bootstrap", async () => {
    const { service, calls } = makeHarness({
      codex: templateSpec("codex"),
      mock: templateSpec(),
    });
    await service.create({
      name: "my-kb",
      templateId: "codex",
      kbTemplateId: "llm-wiki",
    });
    await service.create({
      name: "my-kb",
      templateId: "mock",
      kbTemplateId: "llm-wiki",
    });
    await service.create({
      name: "my-kb",
      image: "quay.io/example/custom:latest",
      kbTemplateId: "llm-wiki",
    });
    const commands = calls.bumped.map(
      ({ events }) =>
        (events[0] as { payload: { command: string } }).payload.command,
    );
    expect(commands[0]).toContain("LLM_WIKI_HARNESS=codex bash");
    expect(commands[1]).not.toContain("LLM_WIKI_HARNESS");
    expect(commands[2]).not.toContain("LLM_WIKI_HARNESS");
  });

  // TEST_SCENARIO: plain-wiki rides the same contract as llm-wiki — its own env var
  // TEST_SCENARIO: carries the family, and a template with no declared family (the e2e
  // TEST_SCENARIO: mock harness rides this) gets the bare command.
  it("passes the template's harness family to the plain-wiki bootstrap", async () => {
    const { service, calls } = makeHarness({
      codex: templateSpec("codex"),
      mock: templateSpec(),
    });
    await service.create({
      name: "my-kb",
      templateId: "codex",
      kbTemplateId: "plain-wiki",
    });
    await service.create({
      name: "my-kb",
      templateId: "mock",
      kbTemplateId: "plain-wiki",
    });
    expect(calls.createInputs).toHaveLength(2);
    const commands = calls.bumped.map(
      ({ events }) =>
        (events[0] as { payload: { command: string } }).payload.command,
    );
    expect(commands[0]).toContain("PLAIN_WIKI_HARNESS=codex bash");
    expect(commands[1]).not.toContain("PLAIN_WIKI_HARNESS");
  });

  // TEST_SCENARIO: an unknown template id is the agents module's error to
  // TEST_SCENARIO: report (NOT_FOUND from its create), so resolving the harness family must
  // TEST_SCENARIO: not fail first.
  it("lets an unknown template id fall through to the agent create", async () => {
    const { service, calls } = makeHarness({});
    await service.create({
      name: "my-kb",
      templateId: "missing",
      kbTemplateId: "llm-wiki",
    });
    expect(calls.createInputs).toHaveLength(1);
  });
});
