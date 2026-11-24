// @vitest-environment happy-dom
// TEST_OVERVIEW: Every panel the chat docks beside the conversation — an artifact, the browser, the changes, a process's output and a file — ends its top bar with the Close panel X, after its other actions, also in the chat, where clearing the side-panel tab closes nothing; clicking it closes the docked panel. An artifact or a file shows no back arrow before its title, as the X is the one way to close it.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

vi.mock("../../modules/artifacts/api/queries.js", () => ({
  useArtifact: () => ({
    data: {
      id: "art-1",
      title: "PM dashboard",
      slug: "pm-dashboard",
      kind: "html",
      contentType: "text/html",
      fileName: "page.html",
      sizeBytes: 9,
      version: 1,
      folderId: null,
      sourcePath: null,
      icon: null,
      agentId: "agent-a",
      visibility: "private",
      interactive: false,
      expiresAt: null,
      viewCount: 0,
      shareUrl: null,
      viewers: [],
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-02T00:00:00.000Z",
    },
    isPending: false,
    isError: false,
    refetch: async () => {},
  }),
  useArtifacts: () => ({ data: [] }),
  useArtifactVersions: () => ({ data: [] }),
  useArtifactContent: () => ({ data: undefined, isLoading: false }),
  useArtifactPreview: () => ({ data: "<p>hi</p>", isLoading: false }),
}));
vi.mock("../../modules/artifacts/api/mutations.js", () => ({
  useCreateArtifact: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteArtifact: () => ({ mutate: vi.fn() }),
  useSaveArtifactContent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSendArtifactPrompt: () => ({ mutateAsync: vi.fn() }),
  useCallAgentApi: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("../../modules/artifacts/hooks/use-file-promotion.js", () => ({
  useFilePromotion: () => ({ pending: false, linked: false, run: vi.fn() }),
}));
vi.mock("../../modules/agents/api/queries.js", () => ({
  useAgentsList: () => [{ id: "agent-a", name: "Jeeves" }],
  cachedAgent: () => undefined,
  useIsAgentOperable: () => true,
}));
vi.mock("../../modules/browser/components/stream-view.js", () => ({
  StreamView: () => null,
}));
vi.mock("../../modules/browser/hooks/use-browser-control.js", () => ({
  useBrowserControl: () => ({
    connection: "live",
    connects: 1,
    browser: { state: "ready", message: null },
    page: {
      url: "http://a/",
      title: "A",
      loading: false,
      canGoBack: false,
      canGoForward: false,
    },
    tabs: undefined,
    activeTab: null,
    error: null,
    navigate: vi.fn(),
    reload: vi.fn(),
    stop: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    selectTab: vi.fn(),
    closeTab: vi.fn(),
    newTab: vi.fn(),
    clearData: vi.fn(),
    restartBrowser: vi.fn(),
    reconnect: vi.fn(),
  }),
}));
vi.mock("../../modules/changes/api/queries.js", () => ({
  useChangeSets: () => ({ data: undefined, error: null, isPending: true }),
  useChangeSetDiff: () => ({ data: undefined }),
}));
vi.mock("../../modules/changes/hooks/use-changes-watch.js", () => ({
  useChangesWatch: () => {},
}));
vi.mock("../../modules/processes/api/queries.js", () => ({
  useProcesses: () => ({ data: undefined, isPending: true, isError: false }),
  useProcessOutput: () => ({ data: undefined, isPending: true }),
}));
vi.mock("../../modules/files/api/queries.js", () => ({
  useFileContentQuery: () => ({
    data: undefined,
    error: undefined,
    refetch: () => {},
  }),
  useFileWriteMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const { TooltipProvider } = await import("../../components/ui/tooltip.js");
const { SidePanelCloseScope } =
  await import("../../modules/sessions/components/side-panel-close-button.js");
const { DockedArtifactPanel } =
  await import("../../modules/artifacts/components/docked-artifact-panel.js");
const { DockedBrowserPanel } =
  await import("../../modules/browser/components/docked-browser-panel.js");
const { DockedChangesPanel } =
  await import("../../modules/changes/components/docked-changes-panel.js");
const { DockedProcessOutputPanel } =
  await import("../../modules/processes/components/docked-process-output-panel.js");
const { DockedFilePanel } =
  await import("../../modules/files/components/docked-file-panel.js");
const { FileViewer } =
  await import("../../modules/files/components/file-viewer.js");
const { useStore } = await import("../../store.js");

type Dock = ReturnType<typeof useStore.getState>["dock"];

let host: HTMLDivElement;
let root: Root;

/** Renders a docked panel the way the chat does: in a scope where clearing the side-panel tab closes nothing. */
function renderInChat(node: ReactNode) {
  act(() =>
    root.render(
      createElement(
        TooltipProvider,
        null,
        createElement(SidePanelCloseScope, { value: false }, node),
      ),
    ),
  );
}

const header = () => host.firstElementChild!.firstElementChild as HTMLElement;
const headerButtons = () => [
  ...header().querySelectorAll<HTMLElement>("button, a"),
];

beforeEach(() => {
  useStore.setState({ selectedAgent: "agent-a", openArtifactDirty: false });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
});

const panels: [string, Dock, () => ReactNode][] = [
  [
    "an artifact",
    { kind: "artifact", id: "art-1" },
    () => createElement(DockedArtifactPanel, { agentId: "agent-a" }),
  ],
  [
    "the browser",
    { kind: "browser", agentId: "agent-a" },
    () =>
      createElement(DockedBrowserPanel, {
        agentId: "agent-a",
        agentName: "Jeeves",
      }),
  ],
  [
    "the changes",
    { kind: "changes", agentId: "agent-a" },
    () =>
      createElement(DockedChangesPanel, {
        agentId: "agent-a",
        sessionId: null,
      }),
  ],
  [
    "a process's output",
    { kind: "process-output", key: "p1" },
    () =>
      createElement(DockedProcessOutputPanel, {
        agentId: "agent-a",
        outputKey: "p1",
      }),
  ],
  [
    "a file still loading",
    { kind: "file", path: "notes.md" },
    () => createElement(DockedFilePanel, { onOpenFile: () => {} }),
  ],
];

describe("a panel docked beside the chat", () => {
  // TEST_SCENARIO: AC — the panel is docked in the chat; its top bar's last control is the Close panel X, and a click on it closes the dock.
  it.each(panels)("%s ends its top bar with an X that closes it", async (_, dock, panel) => {
    useStore.setState({ dock });
    renderInChat(panel());
    const buttons = headerButtons();
    const close = buttons.at(-1)!;
    expect(close.getAttribute("aria-label")).toBe("Close panel");
    await act(async () => close.click());
    expect(useStore.getState().dock).toBeNull();
  });

  // TEST_SCENARIO: AC — the artifact panel's header has no back arrow before its title; the X is the one control that closes it.
  it("shows no back arrow on an artifact", () => {
    useStore.setState({ dock: { kind: "artifact", id: "art-1" } });
    renderInChat(createElement(DockedArtifactPanel, { agentId: "agent-a" }));
    const labels = headerButtons().map((el) => el.getAttribute("aria-label"));
    expect(labels).not.toContain("Back to artifacts");
    expect(labels.filter((l) => l === "Close panel")).toHaveLength(1);
  });

  // TEST_SCENARIO: an artifact with unsaved edits asks before the X throws them away, and stays open when the owner keeps editing.
  it("keeps an artifact with unsaved edits open when the owner keeps editing", async () => {
    const showConfirm = vi.fn(async () => false);
    useStore.setState({
      dock: { kind: "artifact", id: "art-1" },
      showConfirm,
    });
    renderInChat(createElement(DockedArtifactPanel, { agentId: "agent-a" }));
    useStore.setState({ openArtifactDirty: true });
    await act(async () => headerButtons().at(-1)!.click());
    expect(showConfirm).toHaveBeenCalledOnce();
    expect(useStore.getState().dock).toEqual({ kind: "artifact", id: "art-1" });
  });

  // TEST_SCENARIO: an open file's header has no back arrow before its path, and ends with the X, which closes the file.
  it("closes an open file with the X, with no back arrow", () => {
    const onClose = vi.fn();
    renderInChat(
      createElement(FileViewer, {
        file: {
          path: "notes.md",
          content: "# Notes",
          binary: false,
          tooLarge: false,
          mimeType: "text/markdown",
        } as never,
        onClose,
        onOpenFile: () => {},
      }),
    );
    const buttons = headerButtons();
    const labels = buttons.map((el) => el.getAttribute("aria-label"));
    expect(labels).not.toContain("Back to files");
    expect(labels.at(-1)).toBe("Close panel");
    act(() => buttons.at(-1)!.click());
    expect(onClose).toHaveBeenCalledOnce();
  });
});
