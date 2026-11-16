// @vitest-environment happy-dom
// TEST_OVERVIEW: the + of the sidebar's Agents section opens a menu with two ways to start, Blank agent and From a starter kit, and creates nothing until the user picks one. Blank agent creates the default agent, From a starter kit opens the kit browser and creates no agent, each pick is recorded as the entry point the user chose, and the + has focus again after the user closes the kit browser.
import { act, createElement, type ReactElement, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  ready: true,
  create: vi.fn(),
  record: vi.fn(),
  store: { setKitBrowserOpen: vi.fn() },
  onChoose: vi.fn(),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactElement }) => children,
}));
vi.mock("../../store.js", () => ({
  useStore: (select: (s: unknown) => unknown) => select(fake.store),
}));
vi.mock("../../modules/agents/hooks/use-create-default-agent.js", () => ({
  useCreateDefaultAgent: () => ({ ready: fake.ready, create: fake.create }),
}));
vi.mock("../../modules/usage/api/mutations.js", () => ({
  useRecordEntryPoint: () => ({ mutate: fake.record }),
}));

const { CreateAgentMenu } =
  await import("../../modules/agents/components/create-agent-menu.js");
const { useFocusTrap } = await import("../../components/modal.js");

let root: Root;
let container: HTMLDivElement;

function render() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root.render(createElement(CreateAgentMenu, { onChoose: fake.onChoose })),
  );
}

beforeEach(() => {
  fake.ready = true;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

const trigger = () => container.querySelector("button")!;
const item = (testId: string) =>
  document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!;

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve)));

function openMenu() {
  act(() => {
    trigger().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
}

async function choose(testId: string) {
  act(() => item(testId).click());
  await settle();
}

// TEST_SCENARIO: the user clicks the +. The menu shows the two ways to start, and no agent exists yet and no kit browser is open, because the user has not picked.
it("opens the two choices and creates nothing", () => {
  render();
  openMenu();
  expect(
    [...document.querySelectorAll('[role="menuitem"]')].map(
      (el) => el.textContent,
    ),
  ).toEqual([
    "Blank agentStart empty and set it up later",
    "From a starter kitPick one built for a job",
  ]);
  expect(fake.create).not.toHaveBeenCalled();
  expect(fake.store.setKitBrowserOpen).not.toHaveBeenCalled();
  expect(fake.record).not.toHaveBeenCalled();
});

// TEST_SCENARIO: the user picks Blank agent. The default agent is created, the pick is recorded as the "sandbox" entry point, and the kit browser stays closed.
it("creates the default agent for Blank agent", async () => {
  render();
  openMenu();
  await choose("sidebar-create-blank-agent");
  expect(fake.create).toHaveBeenCalledOnce();
  expect(fake.record).toHaveBeenCalledExactlyOnceWith({ choice: "sandbox" });
  expect(fake.store.setKitBrowserOpen).not.toHaveBeenCalled();
  expect(fake.onChoose).toHaveBeenCalledOnce();
});

// TEST_SCENARIO: the user picks From a starter kit. The kit browser opens, the pick is recorded as the "starter-kit" entry point, and no agent is created.
it("opens the kit browser for From a starter kit", async () => {
  render();
  openMenu();
  await choose("sidebar-create-from-kit");
  expect(fake.store.setKitBrowserOpen).toHaveBeenCalledExactlyOnceWith(true);
  expect(fake.record).toHaveBeenCalledExactlyOnceWith({
    choice: "starter-kit",
  });
  expect(fake.create).not.toHaveBeenCalled();
  expect(fake.onChoose).toHaveBeenCalledOnce();
});

// TEST_SCENARIO: the agent list or the templates are still loading, so a default agent cannot be created yet. Blank agent is disabled and a click on it creates nothing, while From a starter kit still works.
it("disables Blank agent until a default agent can be created", async () => {
  fake.ready = false;
  render();
  openMenu();
  expect(item("sidebar-create-blank-agent").hasAttribute("data-disabled")).toBe(
    true,
  );
  await choose("sidebar-create-blank-agent");
  expect(fake.create).not.toHaveBeenCalled();
  expect(item("sidebar-create-from-kit").hasAttribute("data-disabled")).toBe(
    false,
  );
});

function KitBrowser({ onClose }: { onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useFocusTrap(panel);
  return createElement(
    "div",
    { ref: panel },
    createElement("button", {
      "data-testid": "kit-browser-close",
      onClick: onClose,
    }),
  );
}

function SidebarWithKitBrowser() {
  const [open, setOpen] = useState(false);
  fake.store.setKitBrowserOpen.mockImplementation(setOpen);
  return createElement(
    "div",
    null,
    createElement(CreateAgentMenu),
    open && createElement(KitBrowser, { onClose: () => setOpen(false) }),
  );
}

// TEST_SCENARIO: the user picks From a starter kit and then closes the kit browser. The + has focus again, so a keyboard user continues from the place in the sidebar where they started.
it("returns focus to the + when the kit browser closes", async () => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(createElement(SidebarWithKitBrowser)));
  openMenu();
  await choose("sidebar-create-from-kit");
  expect(item("kit-browser-close")).not.toBeNull();
  act(() => item("kit-browser-close").click());
  await settle();
  expect(document.activeElement).toBe(trigger());
});
