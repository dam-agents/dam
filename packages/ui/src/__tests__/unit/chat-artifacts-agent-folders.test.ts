// @vitest-environment happy-dom
// TEST_OVERVIEW: In an Agent's chat the Artifacts section on This agent lists only the folders that hold that Agent's artifacts; All lists every folder; a drag shows every folder as a drop target and keeps the one dropped on; a folder created in the section shows at once, empty.
import type { ArtifactFolder, LibraryArtifact } from "api-server-api";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import type { FolderDropCallbacks } from "../../modules/artifacts/hooks/use-artifact-row-drag.js";

const fake = vi.hoisted(() => ({
  artifacts: [] as unknown[],
  folders: [] as unknown[],
  drag: null as unknown,
  onCreated: null as unknown,
  moved: [] as unknown[],
}));

vi.mock("../../store.js", () => ({
  useStore: (select: (s: unknown) => unknown) =>
    select({
      dock: null,
      artifactFolderCollapse: {},
      setArtifactFolderCollapsed: () => {},
      setSidePanelTab: () => {},
    }),
}));
vi.mock("../../modules/artifacts/api/queries.js", () => ({
  useArtifacts: (filter: { agentId?: string } | null) => ({
    data: (fake.artifacts as LibraryArtifact[]).filter(
      (a) => !filter?.agentId || a.agentId === filter.agentId,
    ),
    isError: false,
    isPending: false,
    refetch: async () => {},
  }),
  useArtifactFolders: () => ({
    data: fake.folders,
    isError: false,
    isPending: false,
    refetch: async () => {},
  }),
}));
vi.mock("../../modules/artifacts/api/mutations.js", () => ({
  useDeleteFolder: () => ({ mutate: () => {} }),
  useUpdateArtifact: () => ({
    mutate: (input: unknown) => fake.moved.push(input),
  }),
}));
vi.mock("../../modules/artifacts/hooks/use-open-artifact.js", () => ({
  useOpenArtifact: () => async () => {},
}));
vi.mock("../../modules/artifacts/components/artifact-list-row.js", () => ({
  ArtifactListRow: ({
    artifact,
    drag,
  }: {
    artifact: LibraryArtifact;
    drag: FolderDropCallbacks;
  }) => {
    fake.drag = drag;
    return createElement("div", { "data-artifact": artifact.id });
  },
}));
vi.mock("../../modules/artifacts/components/folder-dialog.js", () => ({
  FolderDialog: ({
    onCreated,
  }: {
    onCreated?: (folder: ArtifactFolder) => void;
  }) => {
    fake.onCreated = onCreated;
    return null;
  },
}));
vi.mock("../../modules/artifacts/components/folder-actions-menu.js", () => ({
  FolderActionsMenu: () => null,
}));

const { ChatArtifactsPanel } =
  await import("../../modules/artifacts/components/chat-artifacts-panel.js");

const artifact = (
  id: string,
  agentId: string,
  folderId: string | null,
): LibraryArtifact => ({
  id,
  sourcePath: null,
  title: id,
  slug: id,
  kind: "markdown",
  contentType: "text/markdown",
  fileName: `${id}.md`,
  sizeBytes: 1,
  version: 1,
  folderId,
  agentId,
  visibility: "private",
  interactive: false,
  viewers: [],
  expiresAt: null,
  viewCount: 0,
  shareUrl: null,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
});

const folder = (id: string, name: string): ArtifactFolder => ({
  id,
  name,
  slug: id,
  artifactCount: 0,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
});

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function mount(agentId: string) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root.render(
      createElement(
        TooltipProvider,
        null,
        createElement(ChatArtifactsPanel, { agentId, open: true }),
      ),
    ),
  );
}

const listed = () =>
  [...container.querySelectorAll("[data-testid^='artifacts-folder-']")].map(
    (el) => el.textContent,
  );
const button = (text: string) =>
  [...container.querySelectorAll("button")].find(
    (b) => b.textContent === text || b.getAttribute("aria-label") === text,
  ) as HTMLButtonElement;
const drag = () => fake.drag as FolderDropCallbacks;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fake.artifacts = [artifact("a1", "agent-a", "f-reports")];
  fake.folders = [folder("f-reports", "Reports")];
  fake.moved = [];
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

// TEST_SCENARIO: AC-1 — Reports holds only agent A's artifact; agent B's chat on This agent does not list it.
it("does not list another Agent's folder on This agent", () => {
  mount("agent-b");
  expect(listed()).toEqual([]);
});

// TEST_SCENARIO: AC-2 — agent A's chat on This agent lists Reports with its artifact.
it("lists the Agent's own folder on This agent", () => {
  mount("agent-a");
  expect(listed()).toEqual([expect.stringContaining("Reports")]);
  expect(container.querySelector("[data-artifact='a1']")).not.toBeNull();
});

// TEST_SCENARIO: AC-3 — agent B's chat switched to All lists Reports with agent A's artifact.
it("lists every folder on All", () => {
  mount("agent-b");
  act(() => button("All").click());
  expect(listed()).toEqual([expect.stringContaining("Reports")]);
  expect(container.querySelector("[data-artifact='a1']")).not.toBeNull();
});

// TEST_SCENARIO: AC-4 — agent B drags its unfiled artifact; Reports shows while the drag lasts, takes the drop, and stays listed after it.
it("shows every folder while dragging and keeps the one dropped on", () => {
  fake.artifacts = [...fake.artifacts, artifact("b1", "agent-b", null)];
  mount("agent-b");
  expect(listed()).toEqual([]);
  act(() => drag().onStart(null));
  expect(listed()).toEqual([expect.stringContaining("Reports")]);
  act(() => drag().onDrop("f-reports", "b1"));
  act(() => drag().onEnd());
  expect(fake.moved).toEqual([{ id: "b1", folderId: "f-reports" }]);
  expect(listed()).toEqual([expect.stringContaining("Reports")]);
});

// TEST_SCENARIO: a drag that ends without a drop hides the other Agent's folder again.
it("hides the other folders again when a drag ends without a drop", () => {
  fake.artifacts = [...fake.artifacts, artifact("b1", "agent-b", null)];
  mount("agent-b");
  act(() => drag().onStart(null));
  act(() => drag().onEnd());
  expect(listed()).toEqual([]);
});

// TEST_SCENARIO: AC-5 — agent B creates Drafts from the section; Drafts is listed at once, empty, while Reports stays hidden.
it("lists a folder created in the section at once, empty", () => {
  mount("agent-b");
  act(() => button("New folder").click());
  fake.folders = [...fake.folders, folder("f-drafts", "Drafts")];
  act(() =>
    (fake.onCreated as (f: ArtifactFolder) => void)(
      folder("f-drafts", "Drafts"),
    ),
  );
  expect(listed()).toEqual([expect.stringContaining("Drafts")]);
});
