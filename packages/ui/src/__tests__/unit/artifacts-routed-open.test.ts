// @vitest-environment happy-dom
// TEST_OVERVIEW: An artifact's own address, `/artifacts/<id>` — the link a private artifact gets in the owner's Slack DM — opens the Artifacts page with that artifact's preview docked, the same state a click on its row produces. Opening it once is enough: closing the preview keeps it closed while the address still names the artifact, and the library alone opens nothing.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";

const store = vi.hoisted(() => ({
  artifactId: null as string | null,
  dock: null as { kind: string; id: string } | null,
  setDock: vi.fn(),
}));

vi.mock("../../store.js", () => ({
  useStore: (select: (s: Record<string, unknown>) => unknown) =>
    select({
      artifactId: store.artifactId,
      dock: store.dock,
      setDock: store.setDock,
      confirmDockDiscard: async () => true,
    }),
}));

vi.mock("../../modules/artifacts/api/queries.js", () => ({
  useArtifacts: () => ({ data: [{ id: "a-1" }, { id: "a-2" }] }),
  useArtifactFolders: () => ({ data: [] }),
}));
vi.mock("../../modules/environments/api/queries.js", () => ({
  useListedEnvironments: () => ({ loading: false, failed: false, data: [] }),
}));
vi.mock("../../modules/artifacts/components/chat-artifacts-panel.js", () => ({
  ChatArtifactsPanel: () => null,
}));
vi.mock("../../modules/artifacts/components/upload-artifact-dialog.js", () => ({
  UploadArtifactDialog: () => null,
}));
vi.mock("../../modules/sessions/components/side-panel-close-button.js", () => ({
  SidePanelCloseScope: ({ children }: { children: unknown }) => children,
}));
vi.mock("../../components/ui/page-header.js", () => ({
  PageHeader: () => null,
}));
vi.mock("../../modules/agents/hooks/use-create-default-agent.js", () => ({
  useCreateDefaultAgent: () => ({ create: vi.fn(), ready: true }),
}));

const { ArtifactsView } =
  await import("../../modules/artifacts/views/artifacts-view.js");

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

const render = () =>
  act(async () => {
    root.render(
      createElement(TooltipProvider, null, createElement(ArtifactsView)),
    );
  });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  store.artifactId = null;
  store.dock = null;
  store.setDock.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
});

describe("the Artifacts page with an artifact's address", () => {
  // TEST_SCENARIO: the address names one artifact, so the page opens its preview beside the library instead of making the owner find it in the list.
  it("opens the artifact the address names", async () => {
    store.artifactId = "a-1";

    await render();

    expect(store.setDock.mock.calls).toEqual([
      [{ kind: "artifact", id: "a-1" }, undefined],
    ]);
  });

  // TEST_SCENARIO: the address keeps naming the artifact after the preview is closed, so the page must not reopen it: closing is the owner's choice, not a route to re-apply.
  it("opens it once, not again when the preview is closed", async () => {
    store.artifactId = "a-1";
    await render();

    store.dock = null;
    await render();

    expect(store.setDock).toHaveBeenCalledTimes(1);
  });

  // TEST_SCENARIO: an address naming another artifact opens that one, so a second link from Slack lands where it says.
  it("opens another artifact when the address changes", async () => {
    store.artifactId = "a-1";
    await render();

    store.artifactId = "a-2";
    await render();

    expect(store.setDock.mock.calls[1]).toEqual([
      { kind: "artifact", id: "a-2" },
      undefined,
    ]);
  });

  it("opens nothing for the library itself", async () => {
    await render();

    expect(store.setDock).not.toHaveBeenCalled();
  });
});
