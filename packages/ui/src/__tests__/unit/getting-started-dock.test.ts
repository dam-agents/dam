// @vitest-environment happy-dom
// TEST_OVERVIEW: The Get started checklist is a dock that floats over the page. Its progress ring is the only thing that opens it, a click elsewhere, Escape, its collapse chevron or Dismiss closes it, and it hangs under the ring in the page's corner or under the chat's top bar. It is gone once every avatar character is unlocked, or while the user has dismissed it.
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
      setChecklistExpanded: fake.setExpanded,
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

const roots: { root: Root; container: HTMLElement }[] = [];

function rendered(placement: "page" | "chat"): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push({ root, container });
  act(() =>
    root.render(
      createElement(
        TooltipProvider,
        null,
        createElement(GettingStartedDock, { placement }),
      ),
    ),
  );
  return container;
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
});

afterEach(unmountAll);

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

// TEST_SCENARIO: Escape closes the dock, as it does every other overlay.
it("closes the dock on Escape", () => {
  fake.expanded = true;
  rendered("page");
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
  expect(fake.setExpanded).toHaveBeenCalledWith(false);
});

// TEST_SCENARIO: the dock hangs in a fixed layer under the ring: below the page's corner row, and below the chat's taller top bar, which is why the two placements differ.
it("places the dock under the ring of its page", () => {
  fake.expanded = true;
  rendered("page");
  expect(inDocument("getting-started-dock-layer")?.className).toContain(
    "top-[60px] md:top-[48px]",
  );
  expect(inDocument("getting-started-dock-layer")?.className).toContain(
    "fixed",
  );
  unmountAll();
  rendered("chat");
  expect(inDocument("getting-started-dock-layer")?.className).toContain(
    "top-[60px] md:top-[78px]",
  );
});

// TEST_SCENARIO: a dismissed checklist is gone until the avatar picker asks for it again, and one whose every character is unlocked is gone for good, so the ring leaves the page's corner too.
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
