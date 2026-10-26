// @vitest-environment happy-dom
// TEST_OVERVIEW: The Get started checklist is a dock that floats over the page. Its progress ring is the only thing that opens it, a click elsewhere, Escape, its collapse chevron or Dismiss closes it, and the card hangs under the ring below the page's corner row, or under the top bar that holds the ring. It is gone once every avatar character is unlocked, or while the user has dismissed it.
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

vi.mock("../../store.js", () => ({
  useStore: (select: (s: unknown) => unknown) =>
    select({
      checklistExpanded: fake.expanded,
      setChecklistExpanded: (expanded: boolean) => {
        fake.expanded = expanded;
        fake.setExpanded(expanded);
      },
      setMobileScreen: () => {},
    }),
}));
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
  placement: "corner" | "bar";
}[] = [];

function dockElement(placement: "corner" | "bar") {
  return createElement(
    TooltipProvider,
    null,
    createElement(GettingStartedDock, { placement }),
  );
}

function rendered(placement: "corner" | "bar"): HTMLElement {
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
  rendered("corner");
  expect(inDocument("getting-started-ring")).not.toBeNull();
  expect(inDocument("getting-started-dock")).toBeNull();
  act(() => inDocument("getting-started-ring")?.click());
  expect(fake.setExpanded).toHaveBeenCalledWith(true);
});

// TEST_SCENARIO: an open dock lists the tasks, and its collapse chevron closes it.
it("closes the dock from its collapse chevron", () => {
  fake.expanded = true;
  rendered("corner");
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
  rendered("corner");
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
  rendered("corner");
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
  rendered("corner");
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
  rendered("corner");
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
  expect(fake.setExpanded).toHaveBeenCalledWith(false);
});

// TEST_SCENARIO: the dock hangs in a fixed layer under the ring, low enough to clear the page's corner row above it, and lower still under the chat's taller top bar.
it("hangs the dock under the ring of its page", () => {
  const layer = () => inDocument("getting-started-dock-layer");
  fake.expanded = true;
  rendered("corner");
  expect(layer()?.className).toContain("fixed");
  expect(layer()?.className).toContain("top-[82px]");
  expect(layer()?.className).toContain("right-4");
  expect(layer()?.className).toContain("md:right-6");
  unmountAll();
  rendered("bar");
  expect(layer()?.className).toContain("fixed");
  expect(layer()?.className).toContain("top-[60px]");
  expect(layer()?.className).toContain("md:top-[78px]");
});

// TEST_SCENARIO: a dismissed checklist is gone until the avatar picker asks for it again, and one whose every character is unlocked is gone for good, so the ring leaves the page's corner too.
it("hides the ring and the dock for a dismissed or finished checklist", () => {
  fake.progress = { unlocks: [], dismissed: true };
  rendered("corner");
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
  rendered("corner");
  expect(inDocument("getting-started-ring")).toBeNull();
  expect(inDocument("getting-started-dock")).toBeNull();
});
