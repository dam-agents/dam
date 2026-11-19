// @vitest-environment happy-dom
// TEST_OVERVIEW: An interactive artifact reads and writes its data through its publishing Agent's API wherever it is shown — docked beside that Agent's chat, in the Artifacts library or another page with no chat, and on its own page opened with Open in new tab. Only sending a prompt into the open chat needs that chat to be the publishing Agent's.
import type { LibraryArtifact } from "api-server-api";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";

const fake = vi.hoisted(() => ({
  artifact: null as unknown,
  frame: null as null | {
    agentApiArtifactId?: string;
    onSendPrompt?: unknown;
  },
}));

vi.mock("../../modules/artifacts/api/queries.js", () => ({
  useArtifact: () => ({
    data: fake.artifact,
    isPending: false,
    isError: false,
    refetch: async () => {},
  }),
  useArtifactVersions: () => ({ data: undefined }),
  useArtifactContent: () => ({ data: undefined, isLoading: false }),
  useArtifactPreview: () => ({ data: "<p>hi</p>", isLoading: false }),
}));
vi.mock("../../modules/artifacts/api/mutations.js", () => ({
  useDeleteArtifact: () => ({ mutate: vi.fn() }),
  useSaveArtifactContent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSendArtifactPrompt: () => ({ mutateAsync: vi.fn() }),
  useCallAgentApi: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("../../modules/agents/api/queries.js", () => ({
  useAgentsList: () => [{ id: "agent-1", name: "Jeeves" }],
  cachedAgent: () => undefined,
}));
vi.mock("../../modules/artifacts/components/deferred-frame.js", () => ({
  DeferredFrame: (props: {
    agentApiArtifactId?: string;
    onSendPrompt?: unknown;
  }) => {
    fake.frame = props;
    return null;
  },
}));

const { ArtifactPanel } =
  await import("../../modules/artifacts/components/artifact-panel.js");

function artifact(overrides: Partial<LibraryArtifact> = {}): LibraryArtifact {
  return {
    id: "art-1",
    title: "PM dashboard",
    slug: "pm-dashboard",
    kind: "html",
    contentType: "text/html",
    fileName: "page.html",
    sizeBytes: 9,
    version: 2,
    folderId: null,
    sourcePath: null,
    icon: null,
    agentId: "agent-1",
    visibility: "private",
    interactive: true,
    expiresAt: null,
    viewCount: 0,
    shareUrl: null,
    viewers: [],
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-02T00:00:00.000Z",
    ...overrides,
  };
}

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const sendPrompt = async () => {};

function render(props: { agentId: string | null; standalone?: boolean }) {
  act(() =>
    root.render(
      createElement(
        TooltipProvider,
        null,
        createElement(ArtifactPanel, {
          artifactId: "art-1",
          agentId: props.agentId,
          onSendPrompt: sendPrompt,
          standalone: props.standalone,
        }),
      ),
    ),
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fake.artifact = artifact();
  fake.frame = null;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
});

describe("the artifact's Agent API outside its agent's chat", () => {
  // TEST_SCENARIO: AC-1 — a private interactive artifact opened with Open in new tab, on its own page with no chat, relays its data requests to its agent, and offers no send-prompt-to-chat.
  it("relays the standalone page's requests, with no chat prompt", () => {
    render({ agentId: null, standalone: true });
    expect(fake.frame?.agentApiArtifactId).toBe("art-1");
    expect(fake.frame?.onSendPrompt).toBeUndefined();
  });

  // TEST_SCENARIO: AC-1 — a restricted artifact, shared with named people, still relays its owner's requests on its own page.
  it("relays a restricted artifact's requests on its own page", () => {
    fake.artifact = artifact({ visibility: "restricted" });
    render({ agentId: null, standalone: true });
    expect(fake.frame?.agentApiArtifactId).toBe("art-1");
  });

  // TEST_SCENARIO: the Artifacts library docks the same panel with no chat agent; the page there relays its requests too.
  it("relays the requests in the library's docked panel", () => {
    render({ agentId: null });
    expect(fake.frame?.agentApiArtifactId).toBe("art-1");
    expect(fake.frame?.onSendPrompt).toBeUndefined();
  });

  // TEST_SCENARIO: beside its own agent's chat, the page relays its requests and may send a prompt into that chat.
  it("relays the requests and the chat prompt beside its agent's chat", () => {
    render({ agentId: "agent-1" });
    expect(fake.frame?.agentApiArtifactId).toBe("art-1");
    expect(fake.frame?.onSendPrompt).toBe(sendPrompt);
  });

  // TEST_SCENARIO: docked beside another agent's chat, the page still calls its own agent, and sends no prompt into that chat.
  it("relays the requests but no chat prompt beside another agent's chat", () => {
    render({ agentId: "agent-2" });
    expect(fake.frame?.agentApiArtifactId).toBe("art-1");
    expect(fake.frame?.onSendPrompt).toBeUndefined();
  });

  // TEST_SCENARIO: a public artifact never calls its agent, on any mount.
  it("relays nothing for a public artifact", () => {
    fake.artifact = artifact({
      visibility: "public",
      shareUrl: "https://share.example.com/a/pm-dashboard",
    });
    render({ agentId: null, standalone: true });
    expect(fake.frame?.agentApiArtifactId).toBeUndefined();
  });
});
