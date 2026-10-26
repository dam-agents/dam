// TEST_OVERVIEW: an Agent with a newer sandbox to move to is marked with an orange "Update available" dot on its "⋯" menu, on its own Update item, and beside its name on the new-session page; an Agent with nothing to move to shows none of them, and offers no Update item.
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

const update = { fromImage: "sandbox:1", toImage: "sandbox:2" };

/* UNIT_BOUNDARY_DESCRIPTION: the Update item reads its own state, so the tree a
 * menu builds holds it as one element with the Agent, never its text. */
const hasUpdateItem = (node: ReactNode): boolean =>
  ([] as ReactNode[])
    .concat(node ?? [])
    .some(
      (child) =>
        isValidElement(child) &&
        (child.type as { name?: string }).name === "AgentUpdateItem",
    );

const dot = (available: boolean) =>
  renderToStaticMarkup(createElement(AgentUpdateDot, { available }));

describe("the update dot", () => {
  // TEST_SCENARIO: an Agent with a newer sandbox carries the dot, named for a reader who cannot see it; an Agent with nothing to move to renders nothing.
  it("marks an update, and nothing without one", () => {
    expect(dot(true)).toContain('aria-label="Update available"');
    expect(dot(true)).toContain("bg-warning");
    expect(dot(false)).toBe("");
  });
});

describe("an Agent's actions menu", () => {
  // TEST_SCENARIO: the Update item, in the "⋯" menu and in the menu a right click opens, carries the dot and appears only while an update is available.
  it.each(["dropdown", "context"] as const)(
    "offers Update with the dot in the %s menu",
    (menu) => {
      const items = (updateAvailable: boolean) =>
        (
          AgentMenuItems({
            agent: {
              id: "a",
              name: "Herbert",
              templateUpdate: updateAvailable ? update : null,
            } as AgentView,
            entries: agentMenuEntries(false),
            onConfigure: () => {},
            onRename: () => {},
            onRemove: () => {},
            onToggleDisabled: () => {},
            onRestart: () => {},
            menu,
          }) as ReactElement<{ children: ReactNode }>
        ).props.children;
      expect(hasUpdateItem(items(true))).toBe(true);
      expect(hasUpdateItem(items(false))).toBe(false);
    },
  );
});

describe("an Agent without an update", () => {
  // TEST_SCENARIO: nothing offers to update an Agent that has nowhere to move to.
  it("offers no Update item", () => {
    const items = AgentMenuItems({
      agent: { id: "a", name: "Herbert", templateUpdate: null } as AgentView,
      entries: agentMenuEntries(false),
      onConfigure: () => {},
      onRename: () => {},
      onRemove: () => {},
      onToggleDisabled: () => {},
      onRestart: () => {},
      menu: "dropdown",
    });
    expect(hasUpdateItem(items)).toBe(false);
  });
});
