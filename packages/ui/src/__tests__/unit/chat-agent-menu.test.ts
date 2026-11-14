// @vitest-environment happy-dom
// TEST_OVERVIEW: The chat's agent menu, as the design's chat refresh draws it: the Agent's avatar, name and state dot are one button that opens Rename, Artifacts and File tree (checked while open), Git Changes, Add editors and Agent settings; Browser and Processes join the same menu, checked the same way, for an Agent that has them, since the design has no other way to open them. Rename opens the Rename agent dialog, Add editors the settings' People, Agent settings their General. The running count shows the Agent's processes through the chat's toggle, and docking them asks first to discard an unsaved draft the dock holds.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentView } from "../../types.js";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const renames = vi.hoisted(() => [] as unknown[]);
vi.mock("../../modules/agents/components/avatar/agent-avatar.js", () => ({
  AgentAvatar: (props: { size: number }) =>
    createElement("span", {
      "data-testid": "avatar",
      "data-size": String(props.size),
    }),
  resolveCharacter: () => "char",
}));
vi.mock("../../modules/agents/api/mutations.js", () => ({
  useUpdateAgent: () => ({
    isPending: false,
    mutateAsync: async (v: unknown) => {
      renames.push(v);
    },
  }),
}));
vi.mock("../../modules/processes/hooks/use-running-processes.js", () => ({
  useRunningProcesses: () => ({
    running: 3,
    keepingAwake: 1,
    restartPending: false,
  }),
}));

const { TooltipProvider } = await import("../../components/ui/tooltip.js");
const { ClassicChatIdentity } =
  await import("../../modules/sessions/components/classic-chat-identity.js");
const { ProcessesIndicator } =
  await import("../../modules/processes/components/processes-indicator.js");
const { useToggleProcesses } =
  await import("../../modules/processes/hooks/use-toggle-processes.js");
const { useStore } = await import("../../store.js");

const ALPHA = {
  id: "agent-a",
  name: "Alpha",
  avatar: null,
  access: { role: "owner", editors: [], permissions: [] },
} as unknown as AgentView;

let host: HTMLDivElement;
let root: Root;
const onOpenSettings = vi.fn();
const toggles = {
  artifacts: vi.fn(),
  files: vi.fn(),
  browser: vi.fn(),
  processes: vi.fn(),
  changes: vi.fn(),
};

function render(node: ReactNode) {
  act(() => root.render(createElement(TooltipProvider, null, node)));
}

function menu(opts: { extras?: boolean; filesOpen?: boolean } = {}) {
  const extras = opts.extras ?? true;
  render(
    createElement(ClassicChatIdentity, {
      agent: ALPHA,
      name: ALPHA.name,
      display: { state: "running" } as never,
      artifacts: { open: false, onToggle: toggles.artifacts },
      files: { open: opts.filesOpen ?? false, onToggle: toggles.files },
      browser: extras ? { open: true, onToggle: toggles.browser } : null,
      processes: extras ? { open: false, onToggle: toggles.processes } : null,
      changes: extras ? toggles.changes : null,
      onOpenSettings,
    }),
  );
}

async function openMenu() {
  const trigger = host.querySelector<HTMLButtonElement>(
    '[data-testid="chat-agent-identity"]',
  )!;
  await act(async () => {
    trigger.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
    );
    await new Promise((r) => setTimeout(r, 0));
  });
}
const items = () => [
  ...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
];
const item = (label: string) =>
  items().find((el) => el.textContent?.trim() === label)!;
const labels = () => items().map((el) => el.textContent?.trim());

beforeEach(() => {
  renames.length = 0;
  onOpenSettings.mockReset();
  for (const f of Object.values(toggles)) f.mockReset();
  useStore.setState({ dock: null });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
});

describe("the agent menu's button", () => {
  // TEST_SCENARIO: the button is the design's 24 px avatar, the name and the state dot, with no caret.
  it("is the avatar, the name and the state dot", () => {
    menu();
    const trigger = host.querySelector<HTMLElement>(
      '[data-testid="chat-agent-identity"]',
    )!;
    expect(trigger.textContent).toContain("Alpha");
    expect(
      trigger.querySelector<HTMLElement>('[data-testid="avatar"]')!.dataset
        .size,
    ).toBe("24");
    expect(trigger.querySelector(".rounded-full")).not.toBeNull();
    expect(trigger.querySelector("svg")).toBeNull();
  });
});

describe("the agent menu", () => {
  // TEST_SCENARIO: the menu lists the design's items in its order, with Browser and Processes after File tree for an Agent that has them.
  it("lists the design's items", async () => {
    menu();
    await openMenu();
    expect(labels()).toEqual([
      "Rename",
      "Artifacts",
      "File tree",
      "Browser",
      "Processes",
      "Git Changes",
      "Add editors",
      "Agent settings",
    ]);
  });

  // TEST_SCENARIO: an Agent with no browser, no processes and no repository gets the design's items alone.
  it("leaves out what the Agent does not have", async () => {
    menu({ extras: false });
    await openMenu();
    expect(labels()).toEqual([
      "Rename",
      "Artifacts",
      "File tree",
      "Add editors",
      "Agent settings",
    ]);
  });

  // TEST_SCENARIO: a shown section or dock is checked, here File tree and Browser, and picking an item calls its toggle.
  it("checks what shows and toggles it", async () => {
    menu({ filesOpen: true });
    await openMenu();
    const checked = items()
      .filter((el) => el.querySelector('[data-testid="agent-menu-check"]'))
      .map((el) => el.textContent?.trim());
    expect(checked).toEqual(["File tree", "Browser"]);
    act(() => item("Artifacts").click());
    expect(toggles.artifacts).toHaveBeenCalledTimes(1);
  });

  // TEST_SCENARIO: Add editors opens the settings on People, and Agent settings opens them on General.
  it("opens the settings on People and on General", async () => {
    menu();
    await openMenu();
    act(() => item("Add editors").click());
    expect(onOpenSettings).toHaveBeenLastCalledWith("people");
    await openMenu();
    act(() => item("Agent settings").click());
    expect(onOpenSettings).toHaveBeenLastCalledWith("setup");
  });

  // TEST_SCENARIO: Rename opens the Rename agent dialog with the current name, and Save renames the Agent.
  it("renames the Agent from its dialog", async () => {
    menu();
    await openMenu();
    act(() => item("Rename").click());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Rename agent");
    const input = dialog.querySelector<HTMLInputElement>(
      'input[aria-label="Name"]',
    )!;
    expect(input.value).toBe("Alpha");
    act(() => {
      const set = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      set.call(input, "Beta");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = [...dialog.querySelectorAll("button")].find(
      (b) => b.textContent === "Save",
    )!;
    await act(async () => {
      save.click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(renames).toEqual([{ id: "agent-a", name: "Beta", avatar: "char" }]);
  });
});

describe("the running count", () => {
  // TEST_SCENARIO: the running count, as the design draws it, shows the Agent's processes through the chat's toggle.
  it("shows the Agent's processes", () => {
    const onOpen = vi.fn();
    render(createElement(ProcessesIndicator, { agentId: "agent-a", onOpen }));
    const button = host.querySelector<HTMLButtonElement>(
      '[data-testid="processes-indicator"]',
    )!;
    expect(button.textContent).toContain("3 running");
    expect(button.textContent).toContain("1 keeping it awake");
    act(() => button.click());
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe("docking the processes", () => {
  function Probe() {
    probe.toggle = useToggleProcesses();
    return null;
  }
  const probe: { toggle: ((id: string | null) => Promise<void>) | null } = {
    toggle: null,
  };

  // TEST_SCENARIO: an unsaved file or artifact holds the dock and the person keeps it, so the processes do not replace it; once they discard it, the processes dock.
  it("asks before replacing an unsaved draft", async () => {
    const answers = [false, true];
    useStore.setState({
      dock: { kind: "file", path: "/a.txt" },
      confirmDockDiscard: async () => answers.shift() ?? true,
    });
    render(createElement(Probe));
    await act(async () => {
      await probe.toggle!("agent-a");
    });
    expect(useStore.getState().dock).toEqual({
      kind: "file",
      path: "/a.txt",
    });
    await act(async () => {
      await probe.toggle!("agent-a");
    });
    expect(useStore.getState().dock).toEqual({
      kind: "processes",
      agentId: "agent-a",
    });
  });
});
