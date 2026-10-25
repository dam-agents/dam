// TEST_OVERVIEW: An agent's configuration is four tiles — Models, Connections, Skills and Automations, plus Environments when it owns one — and an address saved before that grouping still lands on the tile that holds what it named. A provider row on Models carries no grant switch, since a profile pick grants a provider.
import { createElement, Fragment, type PropsWithChildren } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import { parseRoute } from "../../modules/platform/lib/routes.js";
import { ProviderGrantRow } from "../../modules/providers/components/provider-grant-row.js";
import { SECTIONS } from "../../modules/sandboxes/components/sandbox-section-nav.js";

vi.mock("@/components/ui/dropdown-menu", () => {
  const passthrough = ({ children }: PropsWithChildren) =>
    createElement(Fragment, null, children);
  return {
    DropdownMenu: passthrough,
    DropdownMenuContent: passthrough,
    DropdownMenuItem: passthrough,
    DropdownMenuTrigger: passthrough,
  };
});

const sectionOf = (path: string) => {
  const route = parseRoute(path);
  return route.view === "sandbox-home" ? route.sandboxSection : null;
};

describe("the agent's configuration rail", () => {
  /** TEST_SCENARIO: the four grouped tiles, and the pages an agent keeps beside them. */
  it("offers four configuration tiles, not the seven it had", () => {
    expect(SECTIONS.map((s) => s.section)).toEqual([
      "setup",
      "people",
      "models",
      "connections",
      "skills",
      "automations",
      "environments",
      "chat-forms",
    ]);
  });

  /** TEST_SCENARIO: a bookmark of a panel the page used to have opens the tile that holds it now. */
  it("lands an older address on the tile that holds it", () => {
    const moves: [string, string][] = [
      ["providers", "models"],
      ["usage", "models"],
      ["network", "connections"],
      ["environment", "connections"],
      ["channels", "automations"],
      ["schedules", "automations"],
    ];
    for (const [from, to] of moves)
      expect(sectionOf(`/sandboxes/a1/${from}`)).toBe(to);
    expect(sectionOf("/sandboxes/a1/models")).toBe("models");
    expect(sectionOf("/sandboxes/a1/environments")).toBe("environments");
  });
});

describe("a provider on the Models page", () => {
  /** TEST_SCENARIO: the row reads what the provider runs and offers Detach alone — there is no switch that could grant one beside a profile pick. */
  it("carries no grant switch", () => {
    const html = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(ProviderGrantRow, {
          provider: {
            id: "c1",
            name: "CurveBender (shared)",
            type: "ibm-litellm",
            templateId: "curve-bender-deployment",
          },
          harnesses: ["claude-code"],
          actionsLabel: "Detach CurveBender (shared)",
          actions: createElement("span", null, "Detach"),
        }),
      ),
    );
    expect(html).toContain("CurveBender (shared)");
    expect(html).toContain("Detach CurveBender (shared)");
    expect(html).not.toContain('role="switch"');
  });
});
