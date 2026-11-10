// @vitest-environment happy-dom
// TEST_OVERVIEW: In an Agent's chat, the avatar and name at the start of the top bar are one button that opens the Agent's settings in a modal over the conversation, instead of leaving the chat for the configuration page. The modal shows the configuration page's sections, opens at the section it was asked for, and switches sections inside itself without changing the chat's address. Its X closes it, opening one of the Agent's sessions from it closes it, and switching the chat to another Agent drops it.
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
const { ClassicChatIdentity } =
  await import("../../modules/sessions/components/classic-chat-identity.js");
const { useAgentSettingsModal } =
  await import("../../modules/sessions/hooks/use-agent-settings-modal.js");
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
  const { openSettings, settingsModal } = useAgentSettingsModal(agent);
  return createElement(
    "div",
    null,
    createElement(
      "button",
      { type: "button", onClick: () => openSettings(section) },
      "open settings",
    ),
    settingsModal,
  );
}

const dialog = () =>
  document.body.querySelector<HTMLElement>('[role="dialog"]');
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
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
});

describe("the top bar's avatar and name", () => {
  // TEST_SCENARIO: the avatar and the name are one button, named for configuring the Agent; a click opens the settings over the chat and does not go to the configuration page, which the wrench still opens.
  it("open the Agent's settings over the chat", () => {
    const onOpenSettings = vi.fn();
    const onConfigure = vi.fn();
    render(
      createElement(ClassicChatIdentity, {
        agent: ALPHA,
        agentId: ALPHA.id,
        name: ALPHA.name,
        display: null,
        canOpenBrowser: false,
        canShowChanges: false,
        browserOpen: false,
        changesOpen: false,
        onToggleBrowser: () => {},
        onToggleChanges: () => {},
        onConfigure,
        onOpenSettings,
      }),
    );
    const button = host.querySelector<HTMLButtonElement>(
      '[data-testid="chat-agent-identity"]',
    )!;
    expect(button.getAttribute("aria-label")).toBe("Configure Alpha");
    expect(button.textContent).toContain("Alpha");
    expect(button.querySelector('[data-testid="avatar"]')).not.toBeNull();
    expect(button.closest("h1")).not.toBeNull();
    act(() => button.click());
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onConfigure).not.toHaveBeenCalled();
  });
});

describe("the settings modal", () => {
  // TEST_SCENARIO: opening the settings shows a modal titled for the Agent, on the section asked for, and a later OAuth sign-in returns to the chat.
  it("opens over the chat at the asked section", () => {
    render(createElement(Harness, { agent: ALPHA, section: "schedules" }));
    expect(dialog()).toBeNull();
    clickText("open settings");
    expect(dialog()!.textContent).toContain("Configure Alpha");
    expect(configuration()!.dataset.section).toBe("schedules");
    expect(configuration()!.dataset.agent).toBe("agent-a");
    expect(configuration()!.dataset.return).toBe("/chat/agent-a");
  });

  // TEST_SCENARIO: picking another section switches it inside the modal; the chat's address stays and the configuration page is not opened.
  it("switches sections without leaving the chat", () => {
    const navigateToSandboxHome = vi.fn();
    useStore.setState({ navigateToSandboxHome });
    render(createElement(Harness, { agent: ALPHA }));
    clickText("open settings");
    expect(configuration()!.dataset.section).toBe("setup");
    clickText("Skills");
    expect(configuration()!.dataset.section).toBe("skills");
    expect(location.pathname).toBe("/chat/agent-a");
    expect(navigateToSandboxHome).not.toHaveBeenCalled();
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
});
