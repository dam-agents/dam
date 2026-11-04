// @vitest-environment happy-dom
// TEST_OVERVIEW: The Get started checklist is a sidebar footer item: a progress ring with its label, or the ring alone on the collapsed rail, named with the progress and the unseen unlocks in both states. A click opens the checklist beside it, Escape, its close button, Dismiss or a task row closes it back to the item, and an unseen unlock is celebrated in the popover's place before it counts, taking the keyboard with it. It is gone once every avatar character is unlocked, or while the user has dismissed it, and the open flag goes when the item leaves the screen or its drawer closes. This file gives every document listener a fresh handler identity, tracked per event type so removal unregisters the right one, because happy-dom drops a listener that is re-registered with the identity it used before.
import type { AvatarUnlock, GettingStartedProgress } from "api-server-api";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  progress: { unlocks: [], dismissed: false } as GettingStartedProgress,
  expanded: false,
  wide: true,
  setExpanded: vi.fn(),
  markSeen: vi.fn(),
  setDismissed: vi.fn(),
  startTask: vi.fn(),
}));

vi.mock("../../hooks/use-is-desktop.js", () => ({
  useIsDesktop: () => fake.wide,
  useIsWideDesktop: () => fake.wide,
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

const nativeAdd = document.addEventListener;
const nativeRemove = document.removeEventListener;
const captureOf = (options?: AddEventListenerOptions | boolean) =>
  typeof options === "boolean" ? options : (options?.capture ?? false);
const stacks = new Map<
  EventListenerOrEventListenerObject,
  Map<string, EventListener[]>
>();
document.addEventListener = ((
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: AddEventListenerOptions | boolean,
) => {
  const key = `${type}:${String(captureOf(options))}`;
  const perType = stacks.get(listener) ?? new Map<string, EventListener[]>();
  const wrapped = (event: Event) =>
    typeof listener === "function"
      ? listener(event)
      : listener.handleEvent(event);
  perType.set(key, [...(perType.get(key) ?? []), wrapped]);
  stacks.set(listener, perType);
  nativeAdd.call(document, type, wrapped, options);
}) as typeof document.addEventListener;
document.removeEventListener = ((
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: AddEventListenerOptions | boolean,
) => {
  const key = `${type}:${String(captureOf(options))}`;
  void key;
  nativeRemove.call(document, type, listener, options);
}) as typeof document.removeEventListener;

afterAll(() => {
  document.addEventListener = nativeAdd;
  document.removeEventListener = nativeRemove;
});

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
let expandedProp = true;
let inDrawer = false;

function render(expanded = true, drawer = false) {
  expandedProp = expanded;
  inDrawer = drawer;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  rerender();
}

function rerender(expanded = expandedProp) {
  expandedProp = expanded;
  act(() =>
    root?.render(
      createElement(
        TooltipProvider,
        null,
        createElement(GettingStartedNavItem, { expanded, inDrawer }),
      ),
    ),
  );
}

const inDocument = (testId: string) =>
  document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);

const button = (name: string) =>
  document.querySelector<HTMLElement>(`[aria-label="${name}"]`);

beforeEach(() => {
  fake.progress = { unlocks: [], dismissed: false };
  fake.expanded = false;
  fake.wide = true;
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

// TEST_SCENARIO: the ring alone on the collapsed rail carries the same name as the labelled item, progress and unseen unlocks included, so a screen reader hears what the ring shows.
it("names the item with its progress in both states", () => {
  fake.progress = { unlocks: everything(1), dismissed: false };
  render(false);
  expect(inDocument("getting-started-item")?.textContent).not.toContain(
    "Get started",
  );
  expect(inDocument("getting-started-item")?.getAttribute("aria-label")).toBe(
    "Get started, 1 of 8 done, 7 new avatars",
  );
  rerender(true);
  expect(inDocument("getting-started-item")?.getAttribute("aria-label")).toBe(
    "Get started, 1 of 8 done, 7 new avatars",
  );
});

// TEST_SCENARIO: an open checklist lists the tasks and the eight slots, and its close button shuts it again.
it("lists the tasks and closes from the header", () => {
  fake.expanded = true;
  render();
  expect(inDocument("getting-started-checklist")).not.toBeNull();
  expect(inDocument("getting-started-slots")?.children).toHaveLength(8);
  expect(document.body.textContent).toContain(
    "0 of 8 done · unlock new avatars",
  );
  expect(document.body.textContent).toContain("Create a connection");
  act(() => button("Close checklist")?.click());
  expect(fake.setExpanded).toHaveBeenCalledWith(false);
});

// TEST_SCENARIO: the card never grows past the screen it opens on, so a phone narrower than the card still reads it.
it("caps the checklist at the viewport", () => {
  fake.expanded = true;
  render();
  expect(inDocument("getting-started-checklist")?.className).toContain(
    "max-w-[calc(100vw-2rem)]",
  );
});

// TEST_SCENARIO: Escape closes the checklist, as it does every other overlay.
it("closes on Escape", async () => {
  fake.expanded = true;
  render();
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
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
      .find((b) => b.textContent === "Dismiss")
      ?.click();
  });
  expect(fake.setExpanded).toHaveBeenCalledWith(false);
  expect(fake.setDismissed).toHaveBeenCalledWith({ dismissed: true });
});

// TEST_SCENARIO: a row opens the place where the task is done and closes the checklist on its way.
it("starts a task and closes", () => {
  fake.expanded = true;
  render();
  const row = [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Create a connection"),
  );
  act(() => row?.click());
  expect(fake.startTask).toHaveBeenCalledWith("create-connection");
  expect(fake.setExpanded).toHaveBeenCalledWith(false);
});

// TEST_SCENARIO: the line about a task is a toggletip, so a tap opens it where a hover-only tooltip would show nothing, and the same line is the button's description for a screen reader that never opens it.
it("opens a task's hint on a click, and describes the button with it", () => {
  fake.expanded = true;
  render();
  const info = button("About Create a connection");
  const description = document.getElementById(
    info?.getAttribute("aria-describedby") ?? "",
  );
  expect(description?.textContent).toContain("one credential");
  const hint = description?.textContent ?? "";
  expect(hint).toContain("one credential");
  const shown = () =>
    [...document.querySelectorAll('[role="dialog"]')].some(
      (dialog) => dialog.textContent === hint,
    );
  expect(shown()).toBe(false);
  act(() => info?.click());
  expect(shown()).toBe(true);
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
      .find((b) => b.textContent === "Nice")
      ?.click(),
  );
  act(() => vi.advanceTimersByTime(500));
  expect(fake.markSeen).toHaveBeenCalledWith({ task: "create-agent" });
  vi.useRealTimers();
});

// TEST_SCENARIO: swapping the list for a celebration and back takes the keyboard along, so the button the user was on going away never drops focus to the top of the page.
it("moves focus onto the celebration and back into the list", () => {
  fake.progress = {
    unlocks: [unlock("create-agent", "lens", true)],
    dismissed: false,
  };
  fake.expanded = true;
  render();
  act(() => button("Close checklist")?.focus());
  fake.progress = {
    unlocks: [
      unlock("create-agent", "lens", true),
      unlock("send-message", "wave", false),
    ],
    dismissed: false,
  };
  rerender();
  expect(document.activeElement?.textContent).toBe("Nice");
  fake.progress = {
    unlocks: [
      unlock("create-agent", "lens", true),
      unlock("send-message", "wave", true),
    ],
    dismissed: false,
  };
  rerender();
  expect(document.activeElement).toBe(button("Close checklist"));
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

// TEST_SCENARIO: an item the media query takes off screen — the sidebar on a phone, the drawer on a desktop — closes the checklist, so it does not open unasked when the item comes back; an item that mounts off screen, as the hidden sidebar copy does on a phone, leaves the flag alone for the copy in the drawer.
it("drops the open flag when the item leaves the screen", () => {
  fake.expanded = true;
  render();
  fake.wide = false;
  rerender();
  expect(fake.setExpanded).toHaveBeenCalledWith(false);
  fake.setExpanded.mockClear();
  act(() => root?.unmount());
  root = undefined;
  fake.expanded = true;
  render(true, false);
  expect(fake.setExpanded).not.toHaveBeenCalled();
});

// TEST_SCENARIO: the drawer copy exists only while the drawer is open, so its unmount is the drawer closing, and it closes the checklist it held.
it("drops the open flag when the drawer closes", () => {
  fake.expanded = true;
  fake.wide = false;
  render(true, true);
  expect(inDocument("getting-started-checklist")).not.toBeNull();
  act(() => root?.unmount());
  root = undefined;
  expect(fake.setExpanded).toHaveBeenCalledWith(false);
});
