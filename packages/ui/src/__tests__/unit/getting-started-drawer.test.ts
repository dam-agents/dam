// @vitest-environment happy-dom
// TEST_OVERVIEW: The checklist on a phone lives in the navigation drawer, and the drawer owns the keyboard: the popover it opens must sit inside the drawer's own focus trap, or the trap reads it as focus that left the drawer, pulls the keyboard back and the checklist closes under the user who asked for it. This file mounts the real drawer and the real drawer focus trap, with only the layout questions stubbed out.
import type { GettingStartedProgress } from "api-server-api";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  progress: { unlocks: [], dismissed: false } as GettingStartedProgress,
  expanded: true,
  setOpen: vi.fn(),
  listeners: new Set<() => void>(),
}));

vi.mock("../../hooks/use-is-desktop.js", () => ({
  useIsDesktop: () => false,
  useIsWideDesktop: () => false,
}));
vi.mock("../../store.js", async () => {
  const { useSyncExternalStore } = await import("react");
  const setChecklistExpanded = (open: boolean) => {
    fake.expanded = open;
    fake.setOpen(open);
    for (const listener of fake.listeners) listener();
  };
  return {
    useStore: (select: (state: unknown) => unknown) =>
      useSyncExternalStore(
        (listener) => {
          fake.listeners.add(listener);
          return () => {
            fake.listeners.delete(listener);
          };
        },
        () =>
          select({
            checklistExpanded: fake.expanded,
            setChecklistExpanded,
          }),
      ),
  };
});
vi.mock("../../modules/getting-started/api/queries.js", () => ({
  useGettingStarted: () => ({ data: fake.progress }),
}));
vi.mock("../../modules/getting-started/api/mutations.js", () => ({
  useMarkUnlockSeen: () => ({ mutate: vi.fn() }),
  useSetChecklistDismissed: () => ({ mutate: vi.fn() }),
}));
vi.mock("../../modules/getting-started/hooks/use-start-task.js", () => ({
  useStartTask: () => vi.fn(),
}));

const { TooltipProvider } = await import("../../components/ui/tooltip.js");
const { SideDrawer } = await import("../../components/ui/side-drawer.js");
const { GettingStartedNavItem } =
  await import("../../modules/getting-started/components/getting-started-nav-item.js");

let root: Root | undefined;
let container: HTMLElement | undefined;

function render() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      createElement(
        TooltipProvider,
        null,
        createElement(SideDrawer, {
          side: "left",
          label: "Navigation",
          closing: false,
          onClose: vi.fn(),
          onClosed: vi.fn(),
          children: [
            createElement(
              "button",
              { type: "button", key: "close" },
              "Close navigation",
            ),
            createElement(GettingStartedNavItem, {
              key: "item",
              expanded: true,
              inDrawer: true,
            }),
          ],
        }),
      ),
    ),
  );
}

const tick = () => act(() => new Promise((resolve) => setTimeout(resolve, 40)));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  fake.progress = { unlocks: [], dismissed: false };
  fake.expanded = true;
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(
    () => ({ length: 1 }) as DOMRectList,
  );
});

afterEach(async () => {
  if (root) act(() => root?.unmount());
  root = undefined;
  await tick();
  container?.remove();
  container = undefined;
  vi.restoreAllMocks();
});

// TEST_SCENARIO: the drawer opens with the checklist it was asked for, and its focus trap leaves the keyboard in the checklist instead of pulling it back and closing it.
it("keeps the checklist open under the drawer's focus trap", async () => {
  render();
  await tick();
  expect(fake.setOpen).not.toHaveBeenCalledWith(false);
  expect(fake.expanded).toBe(true);
  expect(
    document.querySelector('[data-testid="getting-started-checklist"]'),
  ).not.toBeNull();
});

// TEST_SCENARIO: the checklist is part of the drawer's own content, so Tab reaches it and the trap counts it as inside.
it("portals the checklist inside the drawer panel", async () => {
  render();
  await tick();
  const panel = document.querySelector<HTMLElement>(
    '[role="dialog"][aria-label="Navigation"]',
  );
  expect(
    panel?.contains(
      document.querySelector('[data-testid="getting-started-checklist"]'),
    ),
  ).toBe(true);
});
