// TEST_OVERVIEW: the agent's Web search control card never hides a stored web search rule. While the control is off, a stored rule still shows with its choice and says it applies once the control is on, because the gate reads that rule before any hold; with no rule stored, the off card shows only the switch. The switch turns on only once the stored rule has loaded, so turning it on can always name that rule; a failed load says so with a retry. The card also says what the control changes in Claude Code's own asking.
import { AGENT_PERMISSIONS, type WebSearchVerdict } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AgentView } from "../../types.js";

vi.stubGlobal("window", new EventTarget());

const world = vi.hoisted(() => ({
  rule: null as null | { verdict: WebSearchVerdict },
  load: "done" as "done" | "pending" | "failed",
}));

vi.mock("../../store.js", () => ({
  useStore: (select: (s: Record<string, unknown>) => unknown) =>
    select({ showConfirm: vi.fn() }),
}));
vi.mock("../../modules/web-search/api/queries.js", () => ({
  useWebSearchState: () => ({
    data:
      world.load === "done"
        ? {
            control: false,
            rule: world.rule && {
              ...world.rule,
              decidedBy: "alice",
              decidedByEmail: "alice@example.com",
              decidedAt: "2026-11-10T12:00:00Z",
            },
          }
        : undefined,
    isPending: world.load === "pending",
    refetch: vi.fn(),
  }),
}));
vi.mock("../../modules/web-search/api/mutations.js", () => ({
  useSetWebSearchControl: () => ({ mutate: vi.fn(), isPending: false }),
  useSetWebSearchRule: () => ({ mutate: vi.fn(), isPending: false }),
}));

const { WebSearchControlCard } =
  await import("../../modules/web-search/components/web-search-control-card.js");

function render(
  rule: null | { verdict: WebSearchVerdict },
  load: "done" | "pending" | "failed" = "done",
): string {
  world.rule = rule;
  world.load = load;
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

  // TEST_SCENARIO: until the stored rule has loaded, turning the switch on could not name a rule that would answer every search, so the switch stays off and disabled; a failed load says so and offers a retry.
  it("turns on only once the stored rule has loaded", () => {
    const switchOf = (html: string) =>
      /<button[^>]*role="switch"[^>]*>/.exec(html)?.[0] ?? "";

    expect(switchOf(render(null))).not.toContain('disabled=""');

    const loading = render(null, "pending");
    expect(switchOf(loading)).toContain('disabled=""');
    expect(loading).toContain("Loading the web search rule");

    const failed = render(null, "failed");
    expect(switchOf(failed)).toContain('disabled=""');
    expect(failed).toContain("Couldn&#x27;t load the web search rule");
    expect(failed).toContain("Retry");
  });
});
