// TEST_OVERVIEW: Where an Agent's image update is offered. Without the new sidebar there is no row menu to carry it, so the page header keeps the Update action; with it, the row menu is the one place an Agent moves and the header carries no second copy.
import { createElement, Fragment, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AgentView } from "../../types.js";

vi.hoisted(() => {
  vi.stubGlobal(
    "window",
    Object.assign(new EventTarget(), {
      location: { pathname: "/", search: "", hash: "" },
    }),
  );
});
import { SandboxHomeHeader } from "../../modules/sandboxes/components/sandbox-home-header.js";

vi.mock("../../modules/agents/hooks/use-update-sandbox.js", () => ({
  useUpdateSandbox: () => ({ updateOne: vi.fn(), updatingId: null }),
}));

vi.mock(
  "../../modules/agents/components/update-available-action.js",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    UpdateAvailableAction: ({ agent }: { agent: AgentView }) =>
      createElement("span", null, `UPDATE-FOR-${agent.id}`),
  }),
);

vi.mock("@/components/ui/page-header", () => {
  const PageHeader = ({
    title,
    actions,
  }: {
    title: string;
    actions?: ReactNode;
  }) =>
    createElement(Fragment, null, createElement("h1", null, title), actions);
  return { PageHeader };
});

const agent = { id: "agent-1", name: "sandbox" } as AgentView;

const render = (showUpdate: boolean) =>
  renderToStaticMarkup(
    createElement(SandboxHomeHeader, {
      title: "Automations",
      agent,
      showUpdate,
    }),
  );

describe("the page header's update action", () => {
  /** TEST_SCENARIO: without the new sidebar the header is where an Agent's
   * update is offered. */
  it("offers the update when the row menu cannot", () => {
    expect(render(true)).toContain("UPDATE-FOR-agent-1");
  });

  /** TEST_SCENARIO: with the new sidebar the row menu carries it, so the header
   * offers no second copy. */
  it("offers nothing when the row menu carries it", () => {
    expect(render(false)).not.toContain("UPDATE-FOR-agent-1");
  });
});
