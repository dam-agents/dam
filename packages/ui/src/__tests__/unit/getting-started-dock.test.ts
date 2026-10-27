// @vitest-environment happy-dom
// TEST_OVERVIEW: The Get started checklist is a dock that floats in the lower right corner, fixed to the window on a page and inside the message area in the chat. Its pill is the only thing that opens it, a click elsewhere, Escape, its collapse chevron or Dismiss closes it back to the pill. It is gone once every avatar character is unlocked, or while the user has dismissed it.
import type { AvatarUnlock, GettingStartedProgress } from "api-server-api";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  progress: { unlocks: [], dismissed: false } as GettingStartedProgress,
  expanded: false,
  setExpanded: vi.fn(),
  markSeen: vi.fn(),
  setDismissed: vi.fn(),
  startTask: vi.fn(),
}));

vi.mock("../../store.js", () => {
  const setChecklistExpanded = (expanded: boolean) => {
    fake.expanded = expanded;
    fake.setExpanded(expanded);
  };
  return {
    useStore: (select: (s: unknown) => unknown) =>
      select({
        checklistExpanded: fake.expanded,
        setChecklistExpanded,
        setMobileScreen: () => {},
      }),
  };
});
vi.mock("../../modules/getting-started/api/queries.js", () => ({
  useGettingStarted: () => ({ data: fake.progress }),
}));
vi.mock("../../modules/getting-started/api/mutations.js", () => ({
  useMarkUnlockSeen: () => ({ mutate: fake.markSeen }),
  useSetChecklistDismissed: () => ({ mutate: fake.setDismissed }),
}));
vi.mock("../../modules/getting-started/hooks/use-start-task.js", () => ({
  useStartTask: () => fake.startTask,
}));

const { TooltipProvider } = await import("../../components/ui/tooltip.js");
const { GettingStartedDock } =
  await import("../../modules/getting-started/components/getting-started-dock.js");

const ALL_CHARACTERS: AvatarUnlock["character"][] = [
  "stack",
  "shield",
  "roller",
  "tower",
  "wave",
  "compass",
  "spark",
  "lens",
];

const ALL_TASKS: AvatarUnlock["task"][] = [
  "create-agent",
  "send-message",
  "create-connection",
  "add-skill",
  "apply-starter-kit",
  "create-schedule",
  "create-artifact",
  "connect-slack",
];

const roots: {
  root: Root;
  container: HTMLElement;
  placement: "page" | "chat";
}[] = [];

function dockElement(placement: "page" | "chat") {
  return createElement(
    TooltipProvider,
    null,
    createElement(GettingStartedDock, { placement }),
  );
}

function rendered(placement: "page" | "chat"): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push({ root, container, placement });
  act(() => root.render(dockElement(placement)));
  return container;
}

function rerenderAll() {
  act(() => {
    for (const { root, placement } of roots)
      root.render(dockElement(placement));
  });
}

function unmountAll() {
  for (const { root, container } of roots.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
}

const inDocument = (testId: string) =>
  document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);

beforeEach(() => {
  fake.progress = { unlocks: [], dismissed: false };
  fake.expanded = false;
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  unmountAll();
  vi.useRealTimers();
});

// TEST_SCENARIO: a closed checklist shows only the ring, and the ring's click asks for the dock, which no page load and no unlock does on its own.
it("opens the dock from the ring", () => {
  rendered("page");
  expect(inDocument("getting-started-ring")).not.toBeNull();
  expect(inDocument("getting-started-dock")).toBeNull();
  act(() => inDocument("getting-started-ring")?.click());
  expect(fake.setExpanded).toHaveBeenCalledWith(true);
});

// TEST_SCENARIO: an open dock lists the tasks, and its collapse chevron closes it.
it("closes the dock from its collapse chevron", () => {
  fake.expanded = true;
  rendered("page");
  expect(inDocument("getting-started-dock")).not.toBeNull();
  act(() =>
    document
      .querySelector<HTMLElement>('[aria-label="Collapse checklist"]')
      ?.click(),
  );
  expect(fake.setExpanded).toHaveBeenCalledWith(false);
});

// TEST_SCENARIO: a click on the page under the dock closes it, so the dock never holds a button of the page; a click inside it leaves it open.
it("closes the dock on a click outside it", () => {
  fake.expanded = true;
  rendered("page");
  act(() => {
    document.body.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );
  });
  expect(fake.setExpanded).toHaveBeenCalledWith(false);
  fake.setExpanded.mockClear();
  act(() => {
    inDocument("getting-started-dock")?.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );
  });
  expect(fake.setExpanded).not.toHaveBeenCalled();
});

// TEST_SCENARIO: Dismiss closes the card and clears the open flag, so the next unlock, which clears the dismissal on the server, cannot open a card the user asked to close.
it("clears the open flag when the user dismisses the checklist", () => {
  fake.expanded = true;
  rendered("page");
  act(() => {
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "Dismiss")
      ?.click();
  });
  expect(fake.setExpanded).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(300));
  expect(fake.setExpanded).toHaveBeenCalledWith(false);
  expect(fake.setDismissed).toHaveBeenCalledWith({ dismissed: true });
});

// TEST_SCENARIO: the card takes the keyboard when the user opens it, so its rows are next in the tab order, and gives it back to the ring when it closes, so a keyboard user is not dropped at the top of the page. A page that mounts with the dock already open leaves the keyboard where it is.
it("moves focus into the card and back to the ring", () => {
  fake.expanded = true;
  rendered("page");
  expect(document.activeElement).not.toBe(inDocument("getting-started-dock"));
  fake.expanded = false;
  rerenderAll();
  fake.expanded = true;
  rerenderAll();
  expect(document.activeElement).toBe(inDocument("getting-started-dock"));
  fake.expanded = false;
  rerenderAll();
  expect(document.activeElement).toBe(inDocument("getting-started-ring"));
});

// TEST_SCENARIO: Escape closes the dock, as it does every other overlay.
it("closes the dock on Escape", () => {
  fake.expanded = true;
  rendered("page");
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
  expect(fake.setExpanded).toHaveBeenCalledWith(false);
});

// TEST_SCENARIO: on a page the dock is fixed to the window's lower right corner, and in the chat it sits in the lower right corner of the message area, above the composer.
it("docks in the lower right corner", () => {
  const layer = () =>
    inDocument("getting-started-ring")?.closest(".getting-started-dock");
  rendered("page");
  expect(layer()?.className).toContain("fixed");
  expect(layer()?.className).toContain("right-4");
  expect(layer()?.className).toContain("md:bottom-4");
  unmountAll();
  rendered("chat");
  expect(layer()?.className).toContain("absolute");
  expect(layer()?.className).toContain("right-3");
  expect(layer()?.className).toContain("md:bottom-3");
});

// TEST_SCENARIO: the open card replaces the pill in its corner, and the pill's own X dismisses the checklist without opening it.
it("swaps the pill for the card and dismisses from the pill", () => {
  fake.expanded = true;
  rendered("page");
  expect(inDocument("getting-started-ring")).toBeNull();
  unmountAll();
  fake.expanded = false;
  rendered("page");
  act(() =>
    document
      .querySelector<HTMLElement>('[aria-label="Dismiss checklist"]')
      ?.click(),
  );
  act(() => vi.advanceTimersByTime(300));
  expect(fake.setDismissed).toHaveBeenCalledWith({ dismissed: true });
  expect(fake.setExpanded).not.toHaveBeenCalledWith(true);
});

// TEST_SCENARIO: a dock that leaves the page because the last celebration completed the checklist closes itself, so the reset or the next unlock does not open a card nobody asked for.
it("clears the open flag when the checklist completes", () => {
  fake.expanded = true;
  rendered("page");
  expect(inDocument("getting-started-dock")).not.toBeNull();
  fake.progress = {
    unlocks: ALL_TASKS.map((task, i) => ({
      task,
      character: ALL_CHARACTERS[i]!,
      seen: true,
      fresh: false,
      unlockedAt: "2026-01-01",
    })),
    dismissed: false,
  };
  rerenderAll();
  expect(inDocument("getting-started-dock")).toBeNull();
  expect(fake.setExpanded).toHaveBeenCalledWith(false);
});

// TEST_SCENARIO: a dock that leaves the page because another tab dismissed the checklist closes itself too.
it("clears the open flag when the checklist is dismissed elsewhere", () => {
  fake.expanded = true;
  rendered("page");
  expect(inDocument("getting-started-dock")).not.toBeNull();
  fake.progress = { unlocks: [], dismissed: true };
  rerenderAll();
  expect(inDocument("getting-started-dock")).toBeNull();
  expect(fake.setExpanded).toHaveBeenCalledWith(false);
});

// TEST_SCENARIO: the avatar picker opens a dismissed checklist in one click: the click clears the dismissal on the server and opens the dock, so the dock must not close itself in the moment the dismissal is still in the cache.
it("stays open when the avatar picker clears the dismissal", () => {
  fake.progress = { unlocks: [], dismissed: true };
  rendered("page");
  fake.setExpanded.mockClear();
  act(() => {
    fake.expanded = true;
    rerenderAll();
  });
  expect(fake.setExpanded).not.toHaveBeenCalled();
  fake.progress = { unlocks: [], dismissed: false };
  rerenderAll();
  expect(inDocument("getting-started-dock")).not.toBeNull();
});

// TEST_SCENARIO: a dismissed checklist is gone until the avatar picker asks for it again, and one whose every character is unlocked is gone for good, so the pill leaves the corner too.
it("hides the ring and the dock for a dismissed or finished checklist", () => {
  fake.progress = { unlocks: [], dismissed: true };
  rendered("page");
  expect(inDocument("getting-started-ring")).toBeNull();
  expect(inDocument("getting-started-dock")).toBeNull();
  unmountAll();
  fake.progress = {
    unlocks: ALL_TASKS.map((task, i) => ({
      task,
      character: ALL_CHARACTERS[i]!,
      seen: true,
      fresh: false,
      unlockedAt: "2026-01-01",
    })),
    dismissed: false,
  };
  rendered("page");
  expect(inDocument("getting-started-ring")).toBeNull();
  expect(inDocument("getting-started-dock")).toBeNull();
});
