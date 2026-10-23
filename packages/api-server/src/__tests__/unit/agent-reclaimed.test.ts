// TEST_OVERVIEW: An agent the platform put to sleep early carries the controller's reclaimed-at stamp. The agent view says so while the agent sleeps on that stamp, naming memory it freed, and drops it once a newer activity outdates the stamp or the agent is no longer hibernated.
import { describe, expect, it } from "vitest";

import { parseInfraAgent } from "../../modules/agents/infrastructure/agent-mappers.js";

const RECLAIMED_AT = "2026-10-13T10:00:00Z";

function agent(opts: {
  lastActivity: string;
  reclaimedAt?: string;
  readyReason?: string;
}) {
  return {
    metadata: {
      name: "a",
      annotations: {
        "agent-platform.ai/last-activity": opts.lastActivity,
        ...(opts.reclaimedAt
          ? { "agent-platform.ai/reclaimed-at": opts.reclaimedAt }
          : {}),
      },
    },
    spec: {},
    status: {
      conditions: [
        {
          type: "Ready",
          status: "False",
          reason: opts.readyReason ?? "Hibernated",
          lastTransitionTime: RECLAIMED_AT,
        },
      ],
    },
  };
}

describe("reclaimed", () => {
  it("names the memory a reclaimed agent freed", () => {
    const infra = parseInfraAgent(
      agent({
        lastActivity: "2026-10-13T09:55:00.000Z",
        reclaimedAt: RECLAIMED_AT,
      }),
    );
    expect(infra.reclaimed).toEqual({
      at: "2026-10-13T10:00:00.000Z",
      for: "memory",
    });
  });

  // TEST_SCENARIO: A deliberate touch after the reclaim outdates the stamp, as it does for the controller, so the agent no longer says it was put to sleep early.
  it("drops once newer activity outdates the stamp", () => {
    const infra = parseInfraAgent(
      agent({
        lastActivity: "2026-10-13T10:05:00.000Z",
        reclaimedAt: RECLAIMED_AT,
      }),
    );
    expect(infra.reclaimed).toBeUndefined();
  });

  it("is absent for an agent hibernated by its own timeout", () => {
    const infra = parseInfraAgent(
      agent({ lastActivity: "2026-10-13T09:00:00.000Z" }),
    );
    expect(infra.reclaimed).toBeUndefined();
  });

  it("is absent while the agent is not hibernated", () => {
    const infra = parseInfraAgent(
      agent({
        lastActivity: "2026-10-13T09:55:00.000Z",
        reclaimedAt: RECLAIMED_AT,
        readyReason: "OverBudget",
      }),
    );
    expect(infra.reclaimed).toBeUndefined();
  });
});
