// @vitest-environment happy-dom
// TEST_OVERVIEW: The command palette opens only from its hotkey, Ctrl-K or Ctrl-Shift-P (Cmd on a Mac), as a combobox over a listbox of commands; typing filters and ranks them, Enter runs the selected one after the palette closes and hands focus back, and Escape closes it without running anything.
import { SessionMode } from "api-server-api";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { PaletteInput } from "../../modules/command-palette/lib/commands.js";
import type { AgentView } from "../../types.js";

const owner = (id: string, name: string) =>
  ({
    id,
    name,
    avatar: null,
    state: "running",
    disabled: false,
    overBudget: false,
    access: {
      role: "owner",
      editors: [],
      permissions: ["view", "sessions", "connections", "settings"],
    },
  }) as unknown as AgentView;

const fake = vi.hoisted(() => ({
  actions: {} as Record<string, ReturnType<typeof vi.fn>>,
  input: null as unknown,
}));

vi.mock("../../auth.js", () => ({
  getUser: () => ({ profile: { sub: "user-1" } }),
}));
vi.mock("../../modules/command-palette/hooks/use-palette-input.js", () => ({
  usePaletteInput: () => fake.input,
}));
vi.mock("../../modules/command-palette/hooks/use-palette-actions.js", () => ({
  usePaletteActions: () =>
    new Proxy(fake.actions, {
      get: (spies, key: string) => (spies[key] ??= vi.fn()),
    }),
}));

const { CommandPalette } =
  await import("../../modules/command-palette/components/command-palette.js");

const MAC = /Mac|iP(hone|ad|od)/.test(navigator.platform);

let root: Root;
let host: HTMLDivElement;
let opener: HTMLButtonElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  fake.actions = {};
  fake.input = {
    route: {
      view: "home",
      agentId: null,
      section: null,
      sessionId: null,
      settingsTab: null,
    },
    agents: [owner("alice", "Alice"), owner("bob", "Bob")],
    ownAgents: [],
    sessions: [
      {
        agentId: "alice",
        sessionId: "s1",
        title: "Fix login",
        mode: SessionMode.Chat,
        activityAt: Date.now(),
      },
    ],
    openSession: null,
    artifacts: [],
    kits: [],
    settingsTabs: [{ value: "providers", label: "Providers" }],
    sections: [
      { section: "setup", title: "General" },
      { section: "providers", title: "Providers" },
    ],
    channels: {},
    browserOpen: null,
    changesOpen: null,
    theme: "system",
    showSleeping: false,
    approvalsOpen: false,
    pendingApprovals: [],
    brandShort: "dam",
  } satisfies PaletteInput;
  host = document.createElement("div");
  opener = document.createElement("button");
  document.body.append(opener, host);
  root = createRoot(host);
  act(() => root.render(createElement(CommandPalette)));
  opener.focus();
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
});

function press(target: EventTarget, key: string, mods: KeyboardEventInit = {}) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...mods,
      }),
    );
  });
}

const hotkey = (key: string, shiftKey = false) =>
  press(document.activeElement ?? document.body, key, {
    shiftKey,
    ...(MAC ? { metaKey: true } : { ctrlKey: true }),
  });

const dialog = () => document.querySelector('[role="dialog"]');
const field = () =>
  document.querySelector<HTMLInputElement>(
    '[data-testid="command-palette-input"]',
  )!;
const items = () =>
  [...document.querySelectorAll('[data-testid="command-palette-item"]')].map(
    (el) => el.textContent,
  );

function type(text: string) {
  const input = field();
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const called = () =>
  Object.entries(fake.actions)
    .filter(([, spy]) => spy.mock.calls.length > 0)
    .map(([name]) => name);

async function flush() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

// TEST_SCENARIO: nothing shows until the hotkey; then a combobox over a listbox of commands opens with the search field focused.
it("opens from the hotkey as a combobox and listbox", () => {
  expect(dialog()).toBeNull();
  hotkey("k");
  expect(dialog()).not.toBeNull();
  expect(field().getAttribute("role")).toBe("combobox");
  expect(document.activeElement).toBe(field());
  expect(document.querySelector('[role="listbox"]')).not.toBeNull();
  expect(items().length).toBeGreaterThan(0);
});

// TEST_SCENARIO: Ctrl-Shift-P opens the same palette, and the hotkey pressed again closes it.
it("opens with Shift-P too and toggles closed", () => {
  hotkey("P", true);
  expect(dialog()).not.toBeNull();
  hotkey("k");
  expect(dialog()).toBeNull();
});

// TEST_SCENARIO: typing narrows the list to commands matching every word and ranks them; Enter runs the top one once the palette has closed, records the use in this browser, and gives focus back to what had it.
it("filters, runs the selected command and returns focus", async () => {
  hotkey("k");
  type("alice prov");
  expect(items()).toEqual(["agent Alice: configure Providers"]);
  press(field(), "Enter");
  expect(dialog()).toBeNull();
  expect(called()).toEqual([]);
  await flush();
  expect(fake.actions.configure).toHaveBeenCalledWith("alice", "providers");
  expect(document.activeElement).toBe(opener);
  expect(
    localStorage.getItem("platform-command-palette:v1:frecency"),
  ).toContain("agent:alice:configure:providers");
});

// TEST_SCENARIO: arrow keys move the selection before Enter runs it.
it("moves the selection with the arrow keys", async () => {
  hotkey("k");
  type("providers");
  const [, second] = items();
  press(field(), "ArrowDown");
  const selected = document.querySelector('[aria-selected="true"]');
  expect(selected?.textContent).toBe(second);
  press(field(), "Enter");
  await flush();
  expect(called()).toHaveLength(1);
});

// TEST_SCENARIO: Escape closes the palette and runs nothing.
it("closes on Escape without running anything", async () => {
  hotkey("k");
  type("alice");
  press(field(), "Escape");
  await flush();
  expect(dialog()).toBeNull();
  expect(called()).toEqual([]);
  expect(document.activeElement).toBe(opener);
});

// TEST_SCENARIO: a query nothing matches says so instead of showing an empty box.
it("says when nothing matches", () => {
  hotkey("k");
  type("zzzz");
  expect(items()).toEqual([]);
  expect(dialog()?.textContent).toContain("No matching commands");
});
