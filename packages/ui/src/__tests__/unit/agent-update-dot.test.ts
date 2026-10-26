// TEST_OVERVIEW: an Agent with a newer sandbox to move to is marked with an orange "Update available" dot on its "⋯" menu, on that menu's Configure item, and beside its name on the new-session page, and its General page leads with a row that updates it; an Agent with nothing to move to shows none of them.
import {
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AgentView } from "../../types.js";

vi.hoisted(() => vi.stubGlobal("window", new EventTarget()));
vi.mock("../../store.js", () => ({
  useStore: (select: (s: unknown) => unknown) =>
    select({ navigateToSandboxHome: () => {}, setView: () => {} }),
}));
vi.mock("../../modules/features/hooks/use-unified-right-toolbar.js", () => ({
  useUnifiedRightToolbar: () => false,
}));
vi.mock("../../modules/agents/hooks/use-update-sandbox.js", () => ({
  useUpdateSandbox: () => ({ updateOne: vi.fn(), updatingId: null }),
}));
vi.mock(
  "../../modules/agents/components/update-available-action.js",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    UpdateAvailableAction: () => null,
  }),
);

const { AgentUpdateDot } =
  await import("../../modules/agents/components/update-available-action.js");
const { AgentMenuItems } =
  await import("../../modules/platform/components/sidebar-v2/agent-row-actions.js");
const { agentMenuEntries } =
  await import("../../modules/agents/lib/agent-menu.js");
const { AgentUpdateRow } =
  await import("../../modules/sandboxes/components/agent-update-row.js");

const update = { fromImage: "sandbox:1", toImage: "sandbox:2" };

const dot = (available: boolean) =>
  renderToStaticMarkup(createElement(AgentUpdateDot, { available }));

const marked = (node: ReactNode): boolean =>
  ([] as ReactNode[])
    .concat(node ?? [])
    .some(
      (child) =>
        isValidElement<{ children?: ReactNode; available?: boolean }>(child) &&
        (child.type === AgentUpdateDot
          ? child.props.available === true
          : marked(child.props.children)),
    );

describe("the update dot", () => {
  // TEST_SCENARIO: an Agent with a newer sandbox carries the dot, named for a reader who cannot see it; an Agent with nothing to move to renders nothing.
  it("marks an update, and nothing without one", () => {
    expect(dot(true)).toContain('aria-label="Update available"');
    expect(dot(true)).toContain("bg-warning");
    expect(dot(false)).toBe("");
  });
});

describe("an Agent's actions menu", () => {
  // TEST_SCENARIO: the Configure item, in the "⋯" menu and in the menu a right click opens, carries the dot only while an update is available.
  it.each(["dropdown", "context"] as const)(
    "marks Configure with the dot in the %s menu",
    (menu) => {
      const items = (updateAvailable: boolean) =>
        (
          AgentMenuItems({
            agent: { id: "a1", name: "A", avatar: null } as AgentView,
            entries: agentMenuEntries(false),
            onConfigure: () => {},
            onRename: () => {},
            onRemove: () => {},
            onToggleDisabled: () => {},
            onRestart: () => {},
            updateAvailable,
            menu,
          }) as ReactElement<{ children: ReactNode }>
        ).props.children;
      expect(marked(items(true))).toBe(true);
      expect(marked(items(false))).toBe(false);
    },
  );
});

describe("the General page's update row", () => {
  const agent = { id: "a", name: "Herbert" } as AgentView;

  // TEST_SCENARIO: the row leads the page while an update is available, naming the update and drawing the action that takes it, and is absent otherwise.
  it("leads the page only while an update is available", () => {
    const html = renderToStaticMarkup(
      createElement(AgentUpdateRow, {
        agent: { ...agent, templateUpdate: update },
      }),
    );
    expect(html).toContain("Update this agent");
    expect(html).toContain("A newer version of its sandbox is available.");
    expect(
      renderToStaticMarkup(
        createElement(AgentUpdateRow, {
          agent: { ...agent, templateUpdate: null },
        }),
      ),
    ).toBe("");
  });
});
