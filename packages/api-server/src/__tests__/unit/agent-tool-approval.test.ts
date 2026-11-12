// TEST_OVERVIEW: an agent holds one tool approval (ask, auto or bypass) that every session of it runs on unless the session picked its own. Saving it sends the agent its defaults again, with the approval beside the pairs, so the runtime applies it without asking the api-server. A value none of the agent's harnesses takes from the agent is refused, null removes it, and an agent that has not said hello yet takes any value, since its harnesses are not known.
import { describe, expect, it } from "vitest";
import type { ToolApproval } from "agent-runtime-api";
import { sessionDefaultsEvent } from "../../modules/harness-config/domain/session-defaults-event.js";
import { createHarnessConfigService } from "../../modules/harness-config/services/harness-config-service.js";

const mode = (values: string[]) => ({
  id: "mode",
  name: "Mode",
  category: "mode",
  choices: values.map((value) => ({ value, name: value })),
});

const CLAUDE = {
  harnesses: [
    {
      name: "claude-code",
      harnessConfig: true,
      sessionModel: true,
      harnessConfigCatalog: {
        options: [mode(["auto", "acceptEdits", "plan", "bypassPermissions"])],
      },
    },
  ],
};

const BOB = {
  harnesses: [
    {
      name: "bob",
      harnessConfig: true,
      sessionModel: true,
      harnessConfigCatalog: {
        options: [
          mode(["agent", "ask"]),
          {
            id: "approvals",
            name: "Approvals",
            category: "approvals",
            choices: [
              { value: "auto", name: "Auto-approve" },
              { value: "ask", name: "Ask every time" },
            ],
          },
        ],
      },
    },
  ],
};

function makeService(opts: { capabilities?: unknown; owned?: boolean }) {
  const calls = {
    written: [] as (ToolApproval | null)[],
    published: [] as string[],
  };
  const service = createHarnessConfigService({
    isOwnedAgent: async () => opts.owned ?? true,
    getCapabilities: async () => opts.capabilities,
    pairRepo: {
      writeToolApproval: async (
        _agentId: string,
        value: ToolApproval | null,
      ) => {
        calls.written.push(value);
      },
    },
    publishDefaults: async (agentId: string) => {
      calls.published.push(agentId);
    },
  } as never);
  return { service, calls };
}

describe("an agent's tool approval", () => {
  /** TEST_SCENARIO: The owner sets the agent to bypass and its harness offers it: the value is saved and the agent is sent its defaults again. */
  it("saves a value the agent's harness takes and publishes the defaults", async () => {
    const { service, calls } = makeService({ capabilities: CLAUDE });
    await service.setToolApproval("agent-1", "bypass");
    expect(calls.written).toEqual(["bypass"]);
    expect(calls.published).toEqual(["agent-1"]);
  });

  /** TEST_SCENARIO: Bob keeps approval in a flag of its process, which the agent's value does not reach: an agent that carries only Bob refuses every value and saves nothing, rather than saving one no session would start on. */
  it("refuses a value none of the agent's harnesses takes", async () => {
    const { service, calls } = makeService({ capabilities: BOB });
    await expect(service.setToolApproval("agent-1", "bypass")).rejects.toThrow(
      "none of this agent's harnesses takes the bypass tool approval from the agent",
    );
    await expect(service.setToolApproval("agent-1", "ask")).rejects.toThrow(
      "none of this agent's harnesses takes the ask tool approval from the agent",
    );
    expect(calls.written).toEqual([]);
    expect(calls.published).toEqual([]);
  });

  /** TEST_SCENARIO: The owner removes the agent's tool approval: null is saved whatever the harnesses offer, and the defaults go out again. */
  it("removes the approval with null", async () => {
    const { service, calls } = makeService({ capabilities: BOB });
    await service.setToolApproval("agent-1", null);
    expect(calls.written).toEqual([null]);
    expect(calls.published).toEqual(["agent-1"]);
  });

  /** TEST_SCENARIO: A new agent has not said hello, so its harnesses are unknown: the value is saved, and the runtime applies it where its harness can. */
  it("takes any value before the agent's first hello", async () => {
    const { service, calls } = makeService({ capabilities: undefined });
    await service.setToolApproval("agent-1", "bypass");
    expect(calls.written).toEqual(["bypass"]);
  });

  /** TEST_SCENARIO: A caller that does not own the agent is told it does not exist, and nothing is saved. */
  it("refuses an agent the caller does not own", async () => {
    const { service, calls } = makeService({
      capabilities: CLAUDE,
      owned: false,
    });
    await expect(service.setToolApproval("agent-1", "auto")).rejects.toThrow(
      "agent not found",
    );
    expect(calls.written).toEqual([]);
  });
});

describe("the session-defaults event", () => {
  const pairs = { chat: null, channel: null, scheduled: null };

  /** TEST_SCENARIO: The event the runtime keeps carries the agent's tool approval beside the pairs, and null where the agent holds none. */
  it("carries the agent's tool approval", () => {
    expect(
      sessionDefaultsEvent("agent-1", { ...pairs, toolApproval: "bypass" }, 1)
        .payload.toolApproval,
    ).toBe("bypass");
    expect(
      sessionDefaultsEvent("agent-1", pairs, 1).payload.toolApproval,
    ).toBeNull();
  });
});
