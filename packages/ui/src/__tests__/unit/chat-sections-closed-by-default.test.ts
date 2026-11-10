// @vitest-environment happy-dom
// TEST_OVERVIEW: In an Agent's chat the Files and Artifacts sections start closed, so the conversation has the width. A person with no stored choice sees both closed; a stored choice still wins. On a desktop the top bar's Show files and Show artifacts icons open and close them, the column beside the conversation draws only the open sections and is gone while none is open, and two open sections stack in it with a divider between them; a section's X closes it. A phone keeps every section in its own screen, each folding from its header.
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
const { ClassicChatIdentity } =
  await import("../../modules/sessions/components/classic-chat-identity.js");
const { useStore } = await import("../../store.js");

let host: HTMLDivElement;
let root: Root;

function render(node: ReactNode) {
  act(() => root.render(createElement(TooltipProvider, null, node)));
}

function layout(processesEnabled = false) {
  return createElement(ClassicChatLayout, {
    identity: null,
    status: null,
    notices: createElement("p", { "data-testid": "notices" }),
    agentId: "agent-a",
    agentName: "Alpha",
    alwaysOn: false,
    processesEnabled,
    onOpenFile: () => {},
    panel: null,
    dockHiddenOnPhone: false,
    dock: null,
    maximizable: null,
    onClosePanel: () => {},
    children: createElement("div", { "data-testid": "conversation" }),
  });
}

function identity() {
  return createElement(ClassicChatIdentity, {
    agent: null,
    agentId: "agent-a",
    name: "Alpha",
    display: null,
    canOpenBrowser: false,
    canShowChanges: false,
    browserOpen: false,
    changesOpen: false,
    onToggleBrowser: () => {},
    onToggleChanges: () => {},
    onConfigure: () => {},
  });
}

const byTestId = (id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const column = () => byTestId("chat-sections")!;
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

  // TEST_SCENARIO: the person opened Artifacts before, and the stored choice brings it back open.
  it("keeps a section the person left open", () => {
    localStorage.setItem("platform-artifacts-open", "1");
    localStorage.setItem("platform-files-open", "1");
    expect(sectionsOnStart()).toEqual({ files: true, artifacts: true });
  });
});

describe("the top bar's section icons", () => {
  // TEST_SCENARIO: both sections are closed, so neither icon is pressed; a click on each opens its section and stores the choice, and a second click closes it again.
  it("open and close their section", () => {
    render(identity());
    const files = byTestId("toggle-files-section")!;
    const artifacts = byTestId("toggle-artifacts-section")!;
    expect(files.getAttribute("aria-label")).toBe("Show files");
    expect(artifacts.getAttribute("aria-label")).toBe("Show artifacts");
    expect(files.getAttribute("aria-pressed")).toBe("false");
    expect(artifacts.getAttribute("aria-pressed")).toBe("false");

    click(artifacts);
    expect(useStore.getState().artifactsSectionOpen).toBe(true);
    expect(artifacts.getAttribute("aria-pressed")).toBe("true");
    expect(localStorage.getItem("platform-artifacts-open")).toBe("1");

    click(files);
    expect(useStore.getState().filesSectionOpen).toBe(true);

    click(artifacts);
    expect(useStore.getState().artifactsSectionOpen).toBe(false);
    expect(artifacts.getAttribute("aria-pressed")).toBe("false");
  });
});

describe("the column beside the conversation on a desktop", () => {
  // TEST_SCENARIO: no section is open, so the column draws none and is hidden, and the notices move above the conversation.
  it("is gone while no section is open", () => {
    render(layout(true));
    expect(shownSections()).toEqual([]);
    expect(column().className).toContain("md:!hidden");
    expect(column().contains(byTestId("notices"))).toBe(false);
    expect(byTestId("notices")).not.toBeNull();
  });

  // TEST_SCENARIO: only Artifacts is open, so the column draws it alone, with its X and no fold.
  it("draws only the open section", () => {
    useStore.setState({ artifactsSectionOpen: true });
    render(layout(true));
    expect(shownSections()).toEqual(["section-artifacts"]);
    expect(column().className).not.toContain("md:!hidden");
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
});

describe("the sections screen on a phone", () => {
  // TEST_SCENARIO: a phone opens the column as a screen of its own, so it draws every section, closed ones too, and each folds from its header instead of closing with an X.
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
