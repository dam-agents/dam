// @vitest-environment happy-dom
// TEST_OVERVIEW: The Get started checklist is a sidebar footer item: a progress ring with its label, or the ring alone on the collapsed rail. A click opens the checklist beside it, Escape, its close button, Dismiss or a task row closes it back to the item, and an unseen unlock is celebrated in the popover's place before it counts. It is gone once every avatar character is unlocked, or while the user has dismissed it. This file gives every document listener a fresh handler identity, because happy-dom drops one that Radix's dismissable layer re-registers with the identity it used before.
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
const { GettingStartedNavItem } =
  await import("../../modules/getting-started/components/getting-started-nav-item.js");

const addEventListener = document.addEventListener.bind(document);
document.addEventListener = ((
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: AddEventListenerOptions | boolean,
) => {
  addEventListener(
    type,
    (event: Event) =>
      typeof listener === "function"
        ? listener(event)
        : listener.handleEvent(event),
    options,
  );
}) as typeof document.addEventListener;

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

const unlock = (
  task: AvatarUnlock["task"],
  character: AvatarUnlock["character"],
  seen: boolean,
): AvatarUnlock => ({
  task,
  character,
  seen,
  fresh: !seen,
  unlockedAt: "2026-01-01",
});

const everything = (seen: number): AvatarUnlock[] =>
  ALL_TASKS.map((task, i) => unlock(task, ALL_CHARACTERS[i]!, i < seen));

let root: Root | undefined;
let container: HTMLElement | undefined;

function render(expanded = true) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  rerender(expanded);
}

function rerender(expanded = true) {
  act(() =>
    root?.render(
      createElement(
        TooltipProvider,
        null,
        createElement(GettingStartedNavItem, { expanded }),
      ),
    ),
  );
}

const inDocument = (testId: string) =>
  document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);

beforeEach(() => {
  fake.progress = { unlocks: [], dismissed: false };
  fake.expanded = false;
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
});

// TEST_SCENARIO: the item sits in the footer with its ring and label, and nothing but a click on it opens the checklist.
it("opens the checklist from the footer item", () => {
  render();
  expect(inDocument("getting-started-item")?.textContent).toContain(
    "Get started",
  );
  expect(inDocument("getting-started-checklist")).toBeNull();
  act(() => inDocument("getting-started-item")?.click());
  expect(fake.setExpanded).toHaveBeenCalledWith(true);
});

// TEST_SCENARIO: on the collapsed rail the item is the ring alone, and its accessible name carries the progress a sighted user reads from the ring.
it("names the ring alone when the sidebar is collapsed", () => {
  render(false);
  const item = inDocument("getting-started-item");
  expect(item?.textContent).toBe("");
  expect(item?.getAttribute("aria-label")).toBe("Get started, 0 of 8 done");
});

// TEST_SCENARIO: an open checklist lists the tasks and the eight slots, and its close button shuts it again.
it("lists the tasks and closes from the header", () => {
  fake.expanded = true;
  render();
  expect(inDocument("getting-started-checklist")).not.toBeNull();
  expect(inDocument("getting-started-slots")?.children).toHaveLength(8);
  expect(document.body.textContent).toContain("Create a connection");
  act(() =>
    document
      .querySelector<HTMLElement>('[aria-label="Close checklist"]')
      ?.click(),
  );
  expect(fake.setExpanded).toHaveBeenCalledWith(false);
});

// TEST_SCENARIO: Escape closes the checklist, as it does every other overlay.
it("closes on Escape", () => {
  fake.expanded = true;
  render();
  act(() => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  expect(fake.setExpanded).toHaveBeenCalledWith(false);
});

// TEST_SCENARIO: Dismiss closes the checklist and records it, so the next unlock, which clears the dismissal on the server, cannot open one the user asked to close.
it("dismisses from the panel footer", () => {
  fake.expanded = true;
  render();
  act(() => {
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "Dismiss")
      ?.click();
  });
  expect(fake.setExpanded).toHaveBeenCalledWith(false);
  expect(fake.setDismissed).toHaveBeenCalledWith({ dismissed: true });
});

// TEST_SCENARIO: a row opens the place where the task is done and closes the checklist on its way.
it("starts a task and closes", () => {
  fake.expanded = true;
  render();
  const row = [...document.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Create a connection"),
  );
  act(() => row?.click());
  expect(fake.startTask).toHaveBeenCalledWith("create-connection");
  expect(fake.setExpanded).toHaveBeenCalledWith(false);
});

// TEST_SCENARIO: an unlock the user has not seen takes the popover in place of the list and counts as seen only once its celebration ends, on its own or on "Nice".
it("celebrates an unseen unlock before it counts", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  fake.progress = {
    unlocks: [unlock("create-agent", "lens", false)],
    dismissed: false,
  };
  fake.expanded = true;
  render();
  expect(inDocument("getting-started-celebration")).not.toBeNull();
  expect(inDocument("getting-started-checklist")).toBeNull();
  act(() =>
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "Nice")
      ?.click(),
  );
  act(() => vi.advanceTimersByTime(500));
  expect(fake.markSeen).toHaveBeenCalledWith({ task: "create-agent" });
  vi.useRealTimers();
});

// TEST_SCENARIO: while the checklist is closed, the unseen unlocks ride on the item as a count, so the user knows there is something to open.
it("counts the unseen unlocks on the item", () => {
  fake.progress = { unlocks: everything(1), dismissed: false };
  render();
  expect(inDocument("getting-started-checklist")).toBeNull();
  expect(inDocument("getting-started-unseen")?.textContent).toBe("7");
});

// TEST_SCENARIO: a checklist that another tab dismissed closes itself, so the popover does not hang around for a checklist that is gone.
it("clears the open flag when the checklist is dismissed elsewhere", () => {
  fake.expanded = true;
  render();
  expect(inDocument("getting-started-checklist")).not.toBeNull();
  fake.progress = { unlocks: [], dismissed: true };
  rerender();
  expect(inDocument("getting-started-checklist")).toBeNull();
  expect(fake.setExpanded).toHaveBeenCalledWith(false);
});

// TEST_SCENARIO: the celebration of the eighth unlock closes the checklist behind it, so the reset or the next unlock cannot open one nobody asked for.
it("clears the open flag when the last celebration completes the checklist", () => {
  fake.progress = { unlocks: everything(7), dismissed: false };
  fake.expanded = true;
  render();
  expect(inDocument("getting-started-celebration")).not.toBeNull();
  fake.progress = { unlocks: everything(8), dismissed: false };
  rerender();
  expect(inDocument("getting-started-item")).toBeNull();
  expect(fake.setExpanded).toHaveBeenCalledWith(false);
});

// TEST_SCENARIO: a dismissed or finished checklist hides the footer item itself, so it does not sit there for a user who has nothing left to do.
it("hides the item for a dismissed or finished checklist", () => {
  fake.progress = { unlocks: [], dismissed: true };
  render();
  expect(inDocument("getting-started-item")).toBeNull();
  fake.expanded = true;
  fake.progress = { unlocks: everything(8), dismissed: false };
  rerender();
  expect(inDocument("getting-started-item")).toBeNull();
});
