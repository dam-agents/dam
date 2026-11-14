// @vitest-environment happy-dom
// TEST_OVERVIEW: In an Agent's chat the Files and Artifacts sections start closed, so the conversation has the width; a stored choice still wins. On a desktop the column beside the conversation, 320 px as the design's chat refresh draws it, holds only the open ones and is gone while none is, two open ones stack with a divider, and a section's X closes it; Processes is never in it, since it docks beside the conversation instead. The thin strip across the top shows its border while anything is open beside the conversation. A phone keeps every section, Processes too, in a screen of its own, each folding from its header.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";

import type { PlatformStore } from "../../store.js";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const viewport = vi.hoisted(() => ({ desktop: true }));

function sectionStub(id: string) {
  return (props: {
    open: boolean;
    onToggle?: () => void;
    onClose?: () => void;
  }) =>
    createElement(
      "section",
      {
        "data-testid": `section-${id}`,
        "data-open": String(props.open),
        "data-folds": String(props.onToggle !== undefined),
      },
      props.onClose &&
        createElement(
          "button",
          {
            type: "button",
            "aria-label": `Close ${id}`,
            onClick: props.onClose,
          },
          "x",
        ),
    );
}

vi.mock("../../modules/files/components/files-panel.js", () => ({
  FilesPanel: sectionStub("files"),
}));
vi.mock("../../modules/artifacts/components/chat-artifacts-panel.js", () => ({
  ChatArtifactsPanel: sectionStub("artifacts"),
}));
vi.mock("../../modules/processes/components/processes-panel.js", () => ({
  ProcessesPanel: sectionStub("processes"),
}));
vi.mock("../../modules/home/components/approvals-panel.js", () => ({
  ApprovalsDrawer: () => null,
}));
vi.mock(
  "../../modules/platform/components/sidebar/mobile-menu-button.js",
  () => ({ MobileMenuButton: () => null }),
);
vi.mock("../../hooks/use-is-desktop.js", () => ({
  useIsDesktop: () => viewport.desktop,
}));

const { TooltipProvider } = await import("../../components/ui/tooltip.js");
const { createArtifactsSlice } =
  await import("../../modules/artifacts/store.js");
const { createFilesSlice } = await import("../../modules/files/store.js");
const { ClassicChatLayout } =
  await import("../../modules/sessions/components/classic-chat-layout.js");
const { useStore } = await import("../../store.js");

let host: HTMLDivElement;
let root: Root;

function render(node: ReactNode) {
  act(() => root.render(createElement(TooltipProvider, null, node)));
}

function layout(processesEnabled = false, panel: "dock" | null = null) {
  return createElement(ClassicChatLayout, {
    identity: createElement("span", { "data-testid": "identity" }),
    status: null,
    activity: createElement("span", { "data-testid": "activity" }),
    notices: createElement("p", { "data-testid": "notices" }),
    agentId: "agent-a",
    agentName: "Alpha",
    processesEnabled,
    onOpenFile: () => {},
    panel,
    dockHiddenOnPhone: false,
    dock: panel && createElement("div", { "data-testid": "dock" }),
    maximizable: null,
    onClosePanel: () => {},
    children: createElement("div", { "data-testid": "conversation" }),
  });
}

const byTestId = (id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const column = () => byTestId("chat-sections")!;
const strip = () => byTestId("chat-top-strip")!;
const shownSections = () =>
  [...column().querySelectorAll("section")].map((s) =>
    s.getAttribute("data-testid"),
  );

function click(el: Element | null) {
  act(() => (el as HTMLElement).click());
}

beforeEach(() => {
  localStorage.clear();
  viewport.desktop = true;
  useStore.setState({
    filesSectionOpen: false,
    artifactsSectionOpen: false,
    processesSectionOpen: false,
    mobileScreen: "chat",
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the default for a person with no stored choice", () => {
  function sectionsOnStart() {
    const store = createStore<PlatformStore>()(
      (...a) =>
        ({
          ...createFilesSlice(...a),
          ...createArtifactsSlice(...a),
        }) as PlatformStore,
    );
    const { filesSectionOpen, artifactsSectionOpen } = store.getState();
    return { files: filesSectionOpen, artifacts: artifactsSectionOpen };
  }

  // TEST_SCENARIO: nothing is stored, so both sections start closed and the conversation has the width.
  it("starts Files and Artifacts closed", () => {
    expect(sectionsOnStart()).toEqual({ files: false, artifacts: false });
  });

  // TEST_SCENARIO: the person opened both before, and the stored choice brings them back open.
  it("keeps a section the person left open", () => {
    localStorage.setItem("platform-artifacts-open", "1");
    localStorage.setItem("platform-files-open", "1");
    expect(sectionsOnStart()).toEqual({ files: true, artifacts: true });
  });
});

describe("the column beside the conversation on a desktop", () => {
  // TEST_SCENARIO: no section is open, so the column draws none and is hidden, and the notices move above the conversation.
  it("is gone while no section is open", () => {
    render(layout());
    expect(shownSections()).toEqual([]);
    expect(column().className).toContain("md:!hidden");
    expect(column().contains(byTestId("notices"))).toBe(false);
    expect(byTestId("notices")).not.toBeNull();
  });

  // TEST_SCENARIO: only Artifacts is open, so the column draws it alone, 320 px wide, with its X and no fold.
  it("draws only the open section", () => {
    useStore.setState({ artifactsSectionOpen: true });
    render(layout());
    expect(shownSections()).toEqual(["section-artifacts"]);
    expect(column().className).not.toContain("md:!hidden");
    expect(column().className).toContain("md:w-[320px]");
    expect(byTestId("section-artifacts")!.dataset.folds).toBe("false");
  });

  // TEST_SCENARIO: Files and Artifacts are both open, so they stack in the column, Files above, with a divider between them that resizes the pair.
  it("stacks two open sections with a divider", () => {
    useStore.setState({ filesSectionOpen: true, artifactsSectionOpen: true });
    render(layout());
    expect(shownSections()).toEqual(["section-files", "section-artifacts"]);
    const files = byTestId("section-files")!;
    const divider = files.nextElementSibling;
    expect(divider?.getAttribute("role")).toBe("separator");
    expect(divider?.nextElementSibling).toBe(byTestId("section-artifacts"));
  });

  // TEST_SCENARIO: a section's X closes it, and once the last open section closes the column goes too.
  it("closes a section from its X", () => {
    useStore.setState({ filesSectionOpen: true });
    render(layout());
    click(host.querySelector('[aria-label="Close files"]'));
    expect(useStore.getState().filesSectionOpen).toBe(false);
    expect(shownSections()).toEqual([]);
    expect(column().className).toContain("md:!hidden");
  });

  // TEST_SCENARIO: the Agent's processes are on and Files and Artifacts are closed; Processes docks beside the conversation instead, so the column stays gone.
  it("never holds Processes", () => {
    render(layout(true));
    expect(shownSections()).toEqual([]);
    expect(column().className).toContain("md:!hidden");
  });
});

describe("the chat's header and the strip above it", () => {
  // TEST_SCENARIO: the agent menu sits in the conversation's own header, and the notifications live in the strip across the top.
  it("put the agent menu beside the conversation and the bell on top", () => {
    render(layout());
    const header = host.querySelector("header")!;
    expect(header.contains(byTestId("identity"))).toBe(true);
    expect(header.parentElement!.contains(byTestId("conversation"))).toBe(true);
    expect(strip().contains(byTestId("activity"))).toBe(true);
    expect(host.querySelectorAll('[data-testid="activity"]')).toHaveLength(1);
  });

  // TEST_SCENARIO: a phone has no strip, so the bell sits at the end of the chat's header instead, still drawn once.
  it("puts the bell in the header on a phone", () => {
    viewport.desktop = false;
    render(layout());
    expect(host.querySelector("header")!.contains(byTestId("activity"))).toBe(
      true,
    );
    expect(host.querySelectorAll('[data-testid="activity"]')).toHaveLength(1);
  });

  // TEST_SCENARIO: nothing is open beside the conversation, so the strip's border is transparent; a section or a docked panel draws it.
  it("draws the strip's border only while something is open", () => {
    render(layout());
    expect(strip().className).toContain("border-transparent");
    act(() => useStore.setState({ filesSectionOpen: true }));
    expect(strip().className).toContain("border-border");
    act(() => useStore.setState({ filesSectionOpen: false }));
    render(layout(false, "dock"));
    expect(strip().className).toContain("border-border");
  });
});

describe("the sections screen on a phone", () => {
  // TEST_SCENARIO: a phone opens the column as a screen of its own, so it draws every section, Processes too, closed ones included, and each folds from its header instead of closing with an X.
  it("draws every section, each folding from its header", () => {
    viewport.desktop = false;
    render(layout(true));
    expect(shownSections()).toEqual([
      "section-files",
      "section-artifacts",
      "section-processes",
    ]);
    expect(byTestId("section-files")!.dataset.folds).toBe("true");
    expect(host.querySelector('[aria-label="Close files"]')).toBeNull();
  });
});
