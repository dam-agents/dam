// @vitest-environment happy-dom
// TEST_OVERVIEW: In an Agent's chat, the avatar and name at the start of the top bar are one button, with a tooltip and no caret, that opens the Agent's settings in a modal over the conversation; the top bar's wrench opens the same modal. Every one of them says settings: the button is "<name> settings" and the wrench "Agent settings"; the modal's banner shows the Agent's avatar and name, as the design draws it, and is named "<name> settings". The modal shows all of the Agent's sections, opens at the section it was asked for, and switches sections inside itself without changing the chat's address. There is no settings page beside it, so it offers no link to one, and a sign-in started in it returns to it on Connections. Its X closes it, opening one of the Agent's sessions from it closes it, and switching the chat to another Agent drops it, a switch through a loading chat too. The modal is the app's own, not the chat's: a sidebar row's wrench and a Home card's wrench, both named Agent settings, open the same modal with no chat behind it, and a sidebar wrench for another Agent opens that Agent's modal over a chat.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SandboxSection } from "../../modules/platform/lib/routes.js";
import type { AgentView } from "../../types.js";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

vi.mock("../../modules/getting-started/hooks/use-unlocked-avatars.js", () => ({
  useFreshAvatars: () => [],
}));
vi.mock("../../modules/agents/components/avatar/agent-avatar.js", () => ({
  AgentAvatar: (props: { name: string }) =>
    createElement("span", { "data-testid": "avatar" }, props.name[0]),
  avatarMood: () => "awake",
}));
vi.mock("../../modules/agents/hooks/use-resolved-agent-display.js", () => ({
  useResolvedAgentDisplay: () => ({ state: "running" }),
}));
const known = vi.hoisted(() => ({ agents: [] as AgentView[] }));
vi.mock("../../modules/agents/components/agent-row.js", () => ({
  AgentRow: (props: { onConfigure: () => void; configureLabel: string }) =>
    createElement(
      "button",
      {
        type: "button",
        "aria-label": props.configureLabel,
        "data-testid": "home-card-wrench",
        onClick: props.onConfigure,
      },
      "wrench",
    ),
}));
vi.mock("../../modules/agents/api/queries.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useAgent: (id: string | null) =>
    known.agents.find((a) => a.id === id) ?? null,
}));
vi.mock("../../modules/sandboxes/components/agent-configuration.js", () => ({
  AgentConfiguration: (props: {
    agent: AgentView;
    section: SandboxSection;
    onNavigate: (section: SandboxSection) => void;
    onOpenSession: (sessionId: string) => void;
    oauthReturnView: string;
  }) =>
    createElement(
      "div",
      {
        "data-testid": "configuration",
        "data-section": props.section,
        "data-agent": props.agent.id,
        "data-return": props.oauthReturnView,
      },
      createElement(
        "button",
        { type: "button", onClick: () => props.onNavigate("skills") },
        "Skills",
      ),
      createElement(
        "button",
        { type: "button", onClick: () => props.onOpenSession("session-9") },
        "Open session",
      ),
    ),
}));

const { TooltipProvider } = await import("../../components/ui/tooltip.js");
const { ClassicChatIdentity, ClassicChatToolbar } =
  await import("../../modules/sessions/components/classic-chat-identity.js");
const { useAgentSettingsModal } =
  await import("../../modules/sessions/hooks/use-agent-settings-modal.js");
const { AgentSettingsHost } =
  await import("../../modules/sandboxes/components/agent-settings-host.js");
const { useStore } = await import("../../store.js");

function agentNamed(id: string, name: string): AgentView {
  return {
    id,
    name,
    avatar: null,
    access: { role: "owner", editors: [], permissions: [] },
  } as unknown as AgentView;
}

const ALPHA = agentNamed("agent-a", "Alpha");
const BETA = agentNamed("agent-b", "Beta");
const { SandboxList } =
  await import("../../modules/agents/components/sandbox-list.js");
const { SidebarAgentActions } =
  await import("../../modules/agents/components/sidebar-agent-actions.js");

let host: HTMLDivElement;
let root: Root;

function render(node: ReactNode) {
  act(() => root.render(createElement(TooltipProvider, null, node)));
}

function Harness({
  agent,
  section = "setup",
}: {
  agent: AgentView | null;
  section?: SandboxSection;
}) {
  const { openSettings } = useAgentSettingsModal(agent);
  return createElement(
    "div",
    null,
    createElement(
      "button",
      { type: "button", onClick: () => openSettings(section) },
      "open settings",
    ),
    createElement(AgentSettingsHost),
  );
}

const dialog = () =>
  document.body.querySelector<HTMLElement>('[role="dialog"]');
const bannerName = () =>
  dialog()?.querySelector("h2")?.getAttribute("aria-label") ?? null;
const configuration = () =>
  document.body.querySelector<HTMLElement>('[data-testid="configuration"]');

function clickText(text: string) {
  const button = [...document.body.querySelectorAll("button")].find(
    (b) => b.textContent === text,
  );
  act(() => button!.click());
}

beforeEach(() => {
  history.replaceState(null, "", "/chat/agent-a");
  known.agents = [ALPHA, BETA];
  useStore.setState({ agentSettings: null });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
});

describe("the top bar's avatar and name", () => {
  // TEST_SCENARIO: the avatar and the name are one button, named the Agent's settings, with no caret, as the design draws it; a click opens the settings.
  it("open the Agent's settings over the chat", () => {
    const onConfigure = vi.fn();
    render(
      createElement(ClassicChatIdentity, {
        agent: ALPHA,
        name: ALPHA.name,
        display: null,
        onConfigure,
      }),
    );
    const button = host.querySelector<HTMLButtonElement>(
      '[data-testid="chat-agent-identity"]',
    )!;
    expect(button.getAttribute("aria-label")).toBe("Alpha settings");
    expect(button.textContent).toContain("Alpha");
    expect(button.querySelector('[data-testid="avatar"]')).not.toBeNull();
    expect(button.querySelector("svg")).toBeNull();
    expect(button.closest("h1")).not.toBeNull();
    act(() => button.click());
    expect(onConfigure).toHaveBeenCalledTimes(1);
  });

  // TEST_SCENARIO: the top bar's wrench, Agent settings, calls the same handler as the name, so both open the one settings modal.
  it("share their destination with the wrench", () => {
    const onConfigure = vi.fn();
    render(
      createElement(ClassicChatToolbar, {
        agentId: ALPHA.id,
        canOpenBrowser: false,
        canShowChanges: false,
        browserOpen: false,
        changesOpen: false,
        onToggleBrowser: () => {},
        onToggleChanges: () => {},
        onConfigure,
      }),
    );
    act(() =>
      host
        .querySelector<HTMLButtonElement>('[aria-label="Agent settings"]')!
        .click(),
    );
    expect(onConfigure).toHaveBeenCalledTimes(1);
  });

  // TEST_SCENARIO: the browser and changes buttons are the same 8×8 toggle as the sections' toggles, a pressed one drawn as the neutral square, and the wrench is the same 8×8 square, so all of them line up.
  it("draw the browser and changes buttons as the sections' toggles", () => {
    render(
      createElement(ClassicChatToolbar, {
        agentId: ALPHA.id,
        canOpenBrowser: true,
        canShowChanges: true,
        browserOpen: true,
        changesOpen: false,
        onToggleBrowser: () => {},
        onToggleChanges: () => {},
        onConfigure: () => {},
      }),
    );
    for (const label of ["Open browser", "Show changes"]) {
      const button = host.querySelector<HTMLButtonElement>(
        `[aria-label="${label}"]`,
      )!;
      expect(button.className).toContain("h-8 w-8");
      expect(button.className).toContain("aria-pressed:bg-muted");
    }
    const wrench = host.querySelector<HTMLButtonElement>(
      '[aria-label="Agent settings"]',
    )!;
    expect(wrench.className).toContain("h-8 w-8");
    expect(wrench.className).toContain("rounded-lg");
  });
});

describe("the settings modal", () => {
  // TEST_SCENARIO: opening the settings shows a modal titled for the Agent, on the section asked for, and a later OAuth sign-in returns to the chat.
  it("opens over the chat at the asked section", () => {
    render(createElement(Harness, { agent: ALPHA, section: "schedules" }));
    expect(dialog()).toBeNull();
    clickText("open settings");
    expect(bannerName()).toBe("Alpha settings");
    expect(configuration()!.dataset.section).toBe("schedules");
    expect(configuration()!.dataset.agent).toBe("agent-a");
    expect(configuration()!.dataset.return).toBe(
      "/sandboxes/agent-a/connections",
    );
  });

  // TEST_SCENARIO: picking another section switches it inside the modal, and the chat's address stays.
  it("switches sections without leaving the chat", () => {
    render(createElement(Harness, { agent: ALPHA }));
    clickText("open settings");
    expect(configuration()!.dataset.section).toBe("setup");
    clickText("Skills");
    expect(configuration()!.dataset.section).toBe("skills");
    expect(location.pathname).toBe("/chat/agent-a");
  });

  // TEST_SCENARIO: the modal is the only settings surface, so it offers no link to a page beside it.
  it("has no link to a full settings page", () => {
    render(createElement(Harness, { agent: ALPHA }));
    clickText("open settings");
    expect(
      document.body.querySelector('[data-testid="configure-agent-modal-page"]'),
    ).toBeNull();
    expect(dialog()!.textContent).not.toMatch(/full settings page/i);
  });

  // TEST_SCENARIO: the modal's X closes it and the chat stays.
  it("closes from its X", () => {
    render(createElement(Harness, { agent: ALPHA }));
    clickText("open settings");
    const close = document.body.querySelector<HTMLButtonElement>(
      '[data-testid="configure-agent-modal-close"]',
    )!;
    act(() => close.click());
    expect(dialog()).toBeNull();
  });

  // TEST_SCENARIO: a session opened from the settings, as a schedule's result, closes the modal and opens that session of the Agent.
  it("closes when one of the Agent's sessions opens from it", () => {
    const openAgentSession = vi.fn();
    useStore.setState({ openAgentSession });
    render(createElement(Harness, { agent: ALPHA }));
    clickText("open settings");
    clickText("Open session");
    expect(dialog()).toBeNull();
    expect(openAgentSession).toHaveBeenCalledWith("agent-a", "session-9");
  });

  // TEST_SCENARIO: the chat switches to another Agent while the modal is open, so the modal for the first Agent is dropped rather than shown over the second one's chat.
  it("is dropped when the chat switches Agent", () => {
    render(createElement(Harness, { agent: ALPHA }));
    clickText("open settings");
    expect(dialog()).not.toBeNull();
    render(createElement(Harness, { agent: BETA }));
    expect(dialog()).toBeNull();
  });

  // TEST_SCENARIO: the chat goes through a loading state, with no Agent, on its way to another Agent; the first Agent's modal is still dropped.
  it("is dropped when the chat switches Agent through a load", () => {
    render(createElement(Harness, { agent: ALPHA }));
    clickText("open settings");
    render(createElement(Harness, { agent: null }));
    expect(dialog()).not.toBeNull();
    render(createElement(Harness, { agent: BETA }));
    expect(dialog()).toBeNull();
  });
  // TEST_SCENARIO: the person leaves the chat for Home with the modal open, so the chat unmounts and the modal stays over Home; then another Agent's chat opens, and the first Agent's modal is dropped rather than shown over it.
  it("is dropped when another Agent's chat opens after Home", () => {
    render(createElement(Harness, { agent: ALPHA }));
    clickText("open settings");
    render(createElement(AgentSettingsHost));
    expect(bannerName()).toBe("Alpha settings");
    render(createElement(Harness, { agent: BETA }));
    expect(dialog()).toBeNull();
  });

  // TEST_SCENARIO: an old agent link opens the Agent's chat with its own modal already open, so the chat keeps the modal.
  it("keeps the modal of the Agent the chat opens on", () => {
    useStore.getState().openAgentSettings(BETA.id, "providers");
    render(createElement(Harness, { agent: BETA }));
    expect(bannerName()).toBe("Beta settings");
  });
});

describe("the wrenches outside the chat", () => {
  // TEST_SCENARIO: a sidebar row's wrench is named Agent settings and, wired as the sidebar wires it, opens the app's settings modal for that Agent with no chat on screen.
  it("opens the modal from a sidebar row", () => {
    history.replaceState(null, "", "/");
    render(
      createElement(
        "div",
        null,
        createElement(SidebarAgentActions, {
          channels: {},
          onNewSession: () => {},
          onConfigure: () => useStore.getState().openAgentSettings(ALPHA.id),
          onBind: () => {},
        }),
        createElement(AgentSettingsHost),
      ),
    );
    const wrench = host.querySelector<HTMLButtonElement>(
      '[aria-label="Agent settings"]',
    )!;
    act(() => wrench.click());
    expect(bannerName()).toBe("Alpha settings");
    expect(configuration()!.dataset.section).toBe("setup");
    expect(location.pathname).toBe("/");
  });

  // TEST_SCENARIO: a sidebar row's wrench for another Agent, clicked while one Agent's chat is open, opens the modal for the row's Agent and the chat does not close it.
  it("opens the modal for another Agent over a chat", () => {
    render(
      createElement(
        "div",
        null,
        createElement(Harness, { agent: ALPHA }),
        createElement(SidebarAgentActions, {
          channels: {},
          onNewSession: () => {},
          onConfigure: () => useStore.getState().openAgentSettings(BETA.id),
          onBind: () => {},
        }),
      ),
    );
    act(() =>
      host
        .querySelector<HTMLButtonElement>('[aria-label="Agent settings"]')!
        .click(),
    );
    expect(bannerName()).toBe("Beta settings");
    expect(configuration()!.dataset.agent).toBe("agent-b");
  });

  // TEST_SCENARIO: a Home agent card's wrench, named Agent settings, opens the same modal over Home and stays on Home.
  it("opens the modal from a Home card", () => {
    history.replaceState(null, "", "/");
    render(
      createElement(
        "div",
        null,
        createElement(SandboxList, {
          agents: [ALPHA],
          temporaryCountByDriver: new Map(),
          rowProps: () => ({}),
        } as never),
        createElement(AgentSettingsHost),
      ),
    );
    const wrench = host.querySelector<HTMLButtonElement>(
      '[data-testid="home-card-wrench"]',
    )!;
    expect(wrench.getAttribute("aria-label")).toBe("Agent settings");
    act(() => wrench.click());
    expect(bannerName()).toBe("Alpha settings");
    expect(location.pathname).toBe("/");
  });
});
