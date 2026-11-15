// TEST_OVERVIEW: what the browser is told about a knowledge base. The sharing
// TEST_OVERVIEW: surface is offered on the roots an agent publishes, so a
// TEST_OVERVIEW: projection that drops them leaves the owner with no way to see
// TEST_OVERVIEW: or copy the share link — while the agent itself, which reads
// TEST_OVERVIEW: its roots from its own annotations, publishes perfectly well
// TEST_OVERVIEW: and reports success.
import { toAgentView } from "api-server-api";
import type { Agent } from "api-server-api";
import { describe, expect, it } from "vitest";

function agent(extra: Partial<Agent>): Agent {
  return {
    id: "agent-1",
    name: "wiki",
    state: "running",
    effectiveHibernationTimeoutMin: 60,
    features: { liveUpdates: true },
    stopRequested: false,
    overBudget: false,
    podRestarts: 0,
    contributionFailures: [],
    unsupportedContributionKinds: [],
    workspaceFailures: [],
    channels: [],
    spec: { name: "wiki", image: "img" },
    ...extra,
  } as Agent;
}

describe("the agent view's knowledge-base roots", () => {
  // TEST_SCENARIO: a kit stamps the roots and no kind marker, so the roots are the only thing that says this agent publishes a knowledge base. Dropping them here is invisible server-side and silent in the agent's own chat.
  it("carries the roots a kit declared", () => {
    expect(
      toAgentView(agent({ kbShareRoots: ["wiki", "sources"] })),
    ).toMatchObject({ kbShareRoots: ["wiki", "sources"] });
  });

  // TEST_SCENARIO: an agent stamped before kits says so with its kind, and the browser keys off that instead; it must keep arriving.
  it("carries the kind an agent older than kits was stamped with", () => {
    expect(toAgentView(agent({ kind: "knowledge-base" }))).toMatchObject({
      kind: "knowledge-base",
    });
  });

  it("says nothing about either for an ordinary agent", () => {
    const view = toAgentView(agent({}));
    expect(view.kbShareRoots).toBeUndefined();
    expect(view.kind).toBeUndefined();
  });
});
