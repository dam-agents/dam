// TEST_OVERVIEW: the sweep that clears regular Agents' idle overrides on either store: a regular Agent that never sleeps or has a window of its own loses it, an Environment and an Invocation target keep theirs, and an Agent without one is not written.
import { describe, expect, it } from "vitest";
import type { InfraAgent } from "../../modules/agents/infrastructure/agent-mappers.js";
import { createIdleOverrideSweep } from "../../modules/agents/services/idle-override-sweep.js";

const agent = (id: string, spec: Record<string, unknown>): InfraAgent =>
  ({ id, name: id, spec, sweepable: false }) as unknown as InfraAgent;

describe("the idle override sweep", () => {
  it("clears regular Agents only", async () => {
    const cleared: string[] = [];
    const sweep = createIdleOverrideSweep({
      listAgents: async () => [
        agent("agent-never", { hibernationTimeout: "0s" }),
        agent("agent-window", { hibernationTimeout: "1h0m0s" }),
        agent("agent-env", {
          hibernationTimeout: "0s",
          environmentOf: "agent-never",
        }),
        agent("agent-target", { hibernationTimeout: "5m0s" }),
        agent("agent-plain", {}),
      ],
      invocationIds: async (ids) =>
        new Set(ids.filter((id) => id === "agent-target")),
      clear: async (id) => void cleared.push(id),
    });
    expect(await sweep()).toBe(2);
    expect(cleared).toEqual(["agent-never", "agent-window"]);
  });

  it("asks nothing when no Agent carries an override", async () => {
    const sweep = createIdleOverrideSweep({
      listAgents: async () => [agent("agent-plain", {})],
      invocationIds: async () => {
        throw new Error("no lookup expected");
      },
      clear: async () => {
        throw new Error("no write expected");
      },
    });
    expect(await sweep()).toBe(0);
  });
});
