// @vitest-environment happy-dom
// TEST_OVERVIEW: The docked artifact preview tells a state of the library apart from a failure to load it. An artifact that is gone, or one another owner holds, answers `NOT_FOUND`: the preview says there is no such artifact, as the address `/artifacts/<id>` promises, and offers no retry, because retrying cannot make it appear. Any other failure keeps the retry.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import { artifactMissing } from "../../modules/artifacts/lib/load-failure.js";

const failure = vi.hoisted(() => ({
  error: undefined as unknown,
  refetch: (): void => {},
}));

vi.mock("../../store.js", () => ({
  useStore: (select: (s: Record<string, unknown>) => unknown) =>
    select({
      dock: { kind: "artifact", id: "a-1" },
      setDock: vi.fn(),
      openArtifactEdit: false,
      setOpenArtifactEdit: vi.fn(),
      setOpenArtifactDirty: vi.fn(),
      confirmDockDiscard: async () => true,
      artifactFullPage: false,
      setArtifactFullPage: vi.fn(),
    }),
}));
vi.mock("../../modules/sessions/components/side-panel-close-button.js", () => ({
  SidePanelCloseButton: () => null,
}));
vi.mock("../../modules/artifacts/api/queries.js", () => ({
  useArtifact: () => ({
    data: undefined,
    isPending: false,
    isError: true,
    error: failure.error,
    refetch: failure.refetch,
  }),
  useArtifactVersions: () => ({ data: undefined }),
  useArtifactContent: () => ({ data: undefined, isLoading: false }),
  useArtifactPreview: () => ({ data: undefined, isLoading: false }),
}));
vi.mock("../../modules/artifacts/hooks/use-artifact-editor.js", () => ({
  useArtifactEditor: () => ({
    dirty: false,
    editing: false,
    editable: false,
    draft: "",
    setDraft: vi.fn(),
    save: vi.fn(),
    cancelEdit: vi.fn(),
    startEdit: vi.fn(),
    confirmDiscard: async () => true,
  }),
}));
vi.mock("../../modules/artifacts/hooks/use-artifact-session-prompt.js", () => ({
  useArtifactSessionPrompt: () => undefined,
}));
vi.mock("../../modules/artifacts/hooks/use-start-artifact-session.js", () => ({
  useStartArtifactSession: () => ({ available: false, start: vi.fn() }),
}));

const { DockedArtifactPanel } =
  await import("../../modules/artifacts/components/docked-artifact-panel.js");

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
  failure.error = undefined;
});

const render = async (error: unknown) => {
  failure.error = error;
  await act(async () => {
    root.render(
      createElement(
        TooltipProvider,
        null,
        createElement(DockedArtifactPanel, { agentId: null }),
      ),
    );
  });
  return host.textContent ?? "";
};

describe("the docked preview of an artifact that is not there", () => {
  // TEST_SCENARIO: the artifact is deleted or belongs to someone else, which the query reports as NOT_FOUND; the dock says so and offers no retry.
  it("says there is no such artifact for NOT_FOUND", async () => {
    const text = await render({
      data: { code: "NOT_FOUND" },
      message: "artifact not found",
    });

    expect(text).toContain("Artifact not found");
    expect(text).not.toContain("Retry");
  });

  // TEST_SCENARIO: a failure to reach the api-server is not a missing artifact, so the preview names the failure and keeps the retry.
  it("keeps the retry for a real failure", async () => {
    const text = await render({ data: { code: "INTERNAL_SERVER_ERROR" } });

    expect(text).toContain("Couldn't load the artifact");
    expect(text).toContain("Retry");
  });
});

describe("artifactMissing", () => {
  it("reads only the NOT_FOUND code as a missing artifact", () => {
    expect(artifactMissing({ data: { code: "NOT_FOUND" } })).toBe(true);
    expect(artifactMissing({ data: { code: "INTERNAL_SERVER_ERROR" } })).toBe(
      false,
    );
    expect(artifactMissing({ data: null })).toBe(false);
    expect(artifactMissing(new Error("network"))).toBe(false);
    expect(artifactMissing(undefined)).toBe(false);
  });
});
