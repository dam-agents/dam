// TEST_OVERVIEW: the agent's Web search control card never hides a stored web search rule. While the control is off, a stored rule still shows with its choice and says it applies once the control is on, because the gate reads that rule before any hold; with no rule stored, the off card shows only the switch. The card also says what the control changes in Claude Code's own asking.
import { AGENT_PERMISSIONS, type WebSearchVerdict } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AgentView } from "../../types.js";

vi.stubGlobal("window", new EventTarget());

const world = vi.hoisted(() => ({
  rule: null as null | { verdict: WebSearchVerdict },
}));

vi.mock("../../store.js", () => ({
  useStore: (select: (s: Record<string, unknown>) => unknown) =>
    select({ showConfirm: vi.fn() }),
}));
vi.mock("../../modules/web-search/api/queries.js", () => ({
  useWebSearchState: () => ({
    data: {
      control: false,
      rule: world.rule && {
        ...world.rule,
        decidedBy: "alice",
        decidedByEmail: "alice@example.com",
        decidedAt: "2026-11-10T12:00:00Z",
      },
    },
    isPending: false,
  }),
}));
vi.mock("../../modules/web-search/api/mutations.js", () => ({
  useSetWebSearchControl: () => ({ mutate: vi.fn(), isPending: false }),
  useSetWebSearchRule: () => ({ mutate: vi.fn(), isPending: false }),
}));

const { WebSearchControlCard } =
  await import("../../modules/web-search/components/web-search-control-card.js");

function render(rule: null | { verdict: WebSearchVerdict }): string {
  world.rule = rule;
  const agent = {
    id: "agent-1",
    webSearchControl: false,
    access: { role: "owner", editors: [], permissions: [...AGENT_PERMISSIONS] },
  } as unknown as AgentView;
  return renderToStaticMarkup(createElement(WebSearchControlCard, { agent }));
}

describe("the Web search control card while the control is off", () => {
  // TEST_SCENARIO: an owner answered "Always allow web search" and then turned the control off; the card still shows that rule, selected, and says it applies once the control is on.
  it("shows a stored rule and says when it applies", () => {
    const html = render({ verdict: "allow" });
    expect(html).toContain("When the agent searches");
    expect(html).toMatch(/<option value="allow" selected="">Always allow/);
    expect(html).toContain("Applies once web search control is on.");
  });

  // TEST_SCENARIO: with no rule stored, nothing answers in place of the hold, so the off card shows the switch alone.
  it("shows only the switch when no rule is stored", () => {
    expect(render(null)).not.toContain("When the agent searches");
  });

  // TEST_SCENARIO: with the control on, Claude Code allows its search tool in every Tool approval mode and the gateway asks instead; the card says so before the owner turns the switch, and that other tools keep following Tool approval.
  it("says that Claude Code stops asking about a search", () => {
    const html = render(null);
    expect(html).toContain(
      "Claude Code does not ask about a web search itself",
    );
    expect(html).toContain("Other tools still follow Tool approval.");
  });
});
