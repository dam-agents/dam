// @vitest-environment happy-dom
// TEST_OVERVIEW: Opening a file in the Files panel takes the clicked path before its bytes arrive, so a slow read cannot leave the previous file's content under the new file's name: the dock holds the clicked path at once, and the panel says it is loading, says why a read failed, says when the file is gone, and shows the viewer once the file is there.
import { TRPCClientError } from "@trpc/client";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";

const state = vi.hoisted(() => ({
  read: {} as { data?: unknown; error?: unknown },
  setDock: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock("../../store.js", () => ({
  useStore: (select: (s: Record<string, unknown>) => unknown) =>
    select({
      selectedAgent: "agent-a",
      dock: { kind: "file", path: "qa-qft-20mb.bin" },
      openFileDirty: false,
      setDock: state.setDock,
      setOpenFileEdit: vi.fn(),
      setSidePanelTab: vi.fn(),
      setFilesSectionOpen: vi.fn(),
      setMobileScreen: vi.fn(),
      confirmDockDiscard: async () => true,
      showConfirm: async () => true,
    }),
}));
vi.mock("../../modules/sessions/components/side-panel-close-button.js", () => ({
  SidePanelCloseButton: () => null,
}));
vi.mock("../../modules/agents/api/queries.js", () => ({
  useIsAgentOperable: () => true,
}));
vi.mock("../../modules/files/api/queries.js", () => ({
  useFileContentQuery: () => ({ refetch: () => {}, ...state.read }),
  fetchFileContent: state.readFile,
}));
vi.mock("../../modules/files/components/file-viewer.js", () => ({
  FileViewer: ({ file }: { file: { path: string } }) =>
    createElement("p", null, `viewer:${file.path}`),
}));

const { DockedFilePanel } =
  await import("../../modules/files/components/docked-file-panel.js");
const { useFileTree } =
  await import("../../modules/files/hooks/use-file-tree.js");

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  state.read = {};
  state.setDock.mockClear();
  state.readFile.mockReset();
});

const render = async () => {
  await act(async () => {
    root.render(
      createElement(
        TooltipProvider,
        null,
        createElement(DockedFilePanel, { onOpenFile: () => {} }),
      ),
    );
  });
  return host.textContent ?? "";
};

describe("opening a file", () => {
  const openHandler = async () => {
    let open:
      ((path: string, opts?: { edit?: boolean }) => Promise<void>) | null =
      null;
    function Probe() {
      open = useFileTree("agent-a").openFileHandler;
      return null;
    }
    await act(async () => {
      root.render(createElement(Probe));
    });
    return open!;
  };

  // TEST_SCENARIO: the read of the file just clicked has not finished — the dock must already hold it, or the panel goes on showing the previous file under the new name.
  it("takes the clicked path before its bytes arrive", async () => {
    state.readFile.mockReturnValue(new Promise(() => {}));
    const open = await openHandler();

    void open("work/big.bin");

    await vi.waitFor(() =>
      expect(state.setDock).toHaveBeenCalledWith(
        { kind: "file", path: "work/big.bin" },
        undefined,
      ),
    );
  });
});

describe("the file panel while the file is being read", () => {
  // TEST_SCENARIO: the read of the file just opened is still in flight — the panel names that file and says it is loading, and shows no other file's content.
  it("shows the new file's path and a loading message", async () => {
    const text = await render();

    expect(text).toContain("qa-qft-20mb.bin");
    expect(text).toContain("Loading…");
    expect(text).not.toContain("viewer:");
  });

  // TEST_SCENARIO: the file is not there (a stale row, a dead link from a markdown file) — the panel names it and says so, without a retry that cannot help.
  it("says the file is gone", async () => {
    state.read = {
      error: new TRPCClientError("not found", {
        result: {
          error: {
            code: -32004,
            message: "not found",
            data: { code: "NOT_FOUND" },
          },
        },
      } as never),
    };

    const text = await render();

    expect(text).toContain("qa-qft-20mb.bin is not there any more.");
    expect(text).not.toContain("Retry");
  });

  // TEST_SCENARIO: the read fails — the panel keeps the file's name, gives the reason and offers the retry, instead of an empty pane the row cannot reopen.
  it("gives the reason the read failed and offers a retry", async () => {
    state.read = { error: new Error("agent is not running") };

    const text = await render();

    expect(text).toContain("qa-qft-20mb.bin");
    expect(text).toContain("agent is not running");
    expect(text).toContain("Retry");
  });

  // TEST_SCENARIO: the file arrives — the viewer takes the panel.
  it("hands the panel to the viewer once the file is read", async () => {
    state.read = {
      data: { path: "qa-qft-20mb.bin", content: "", binary: true },
    };

    const text = await render();

    expect(text).toContain("viewer:qa-qft-20mb.bin");
  });
});
