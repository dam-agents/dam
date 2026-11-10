import {
  ARTIFACT_PROMPT_MAX_LENGTH,
  ARTIFACT_PROMPT_TYPE,
  type LibraryArtifact,
} from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  canStartArtifactSession,
  canUseArtifactBridge,
} from "../../modules/artifacts/lib/artifact-bridge.js";
import { readArtifactPrompt } from "../../modules/artifacts/lib/artifact-prompt.js";

const artifact: LibraryArtifact = {
  id: "page",
  slug: "dashboard",
  title: "Dashboard",
  kind: "html",
  fileName: "dashboard.html",
  contentType: "text/html",
  sizeBytes: 100,
  version: 2,
  folderId: null,
  agentId: "agent",
  sourcePath: null,
  visibility: "private",
  interactive: true,
  expiresAt: null,
  viewCount: 0,
  shareUrl: null,
  viewers: [],
  createdAt: "2026-09-16",
  updatedAt: "2026-09-16",
};

describe("artifact callback eligibility", () => {
  it("allows the latest private interactive HTML in its agent's chat", () => {
    expect(canUseArtifactBridge(artifact, "agent", 2)).toBe(true);
  });

  it("keeps the owner's callbacks after the page is shared with named people", () => {
    expect(
      canUseArtifactBridge(
        { ...artifact, visibility: "restricted" },
        "agent",
        2,
      ),
    ).toBe(true);
  });

  it.each<Partial<LibraryArtifact>>([
    { interactive: false },
    { kind: "jsx" },
    { visibility: "public" },
    { agentId: null },
    { agentId: "another-agent" },
  ])("refuses an ineligible artifact: %j", (patch) => {
    expect(canUseArtifactBridge({ ...artifact, ...patch }, "agent", 2)).toBe(
      false,
    );
  });

  it("does not send from historical versions or missing contexts", () => {
    expect(canUseArtifactBridge(artifact, "agent", 1)).toBe(false);
    expect(canUseArtifactBridge(artifact, null, 2)).toBe(false);
    expect(canUseArtifactBridge(null, "agent", 2)).toBe(false);
  });
});

describe("starting a session from an artifact outside a chat", () => {
  it("allows the latest interactive HTML its agent published", () => {
    expect(canStartArtifactSession(artifact, 2)).toBe(true);
    expect(
      canStartArtifactSession({ ...artifact, visibility: "restricted" }, 2),
    ).toBe(true);
  });

  it.each<Partial<LibraryArtifact>>([
    { interactive: false },
    { kind: "jsx" },
    { visibility: "public" },
    { agentId: null },
  ])("refuses an ineligible artifact: %j", (patch) => {
    expect(canStartArtifactSession({ ...artifact, ...patch }, 2)).toBe(false);
  });

  it("refuses historical versions and a missing artifact", () => {
    expect(canStartArtifactSession(artifact, 1)).toBe(false);
    expect(canStartArtifactSession(null, 2)).toBe(false);
  });
});

describe("artifact frame messages", () => {
  it("passes on a page's request for a session of its own", () => {
    const { port1, port2 } = new MessageChannel();
    const data = { type: ARTIFACT_PROMPT_TYPE, prompt: "Go", newSession: true };
    expect(readArtifactPrompt({ source: port1, data }, port1)).toEqual({
      prompt: "Go",
      newSession: true,
    });
    expect(
      readArtifactPrompt(
        { source: port1, data: { ...data, newSession: "yes" } },
        port1,
      ),
    ).toBeNull();
    port1.close();
    port2.close();
  });

  it("passes on the page's conversation key and drops a malformed one", () => {
    const { port1, port2 } = new MessageChannel();
    const data = {
      type: ARTIFACT_PROMPT_TYPE,
      prompt: "Go",
      conversation: "thread:R-1.v2_a-b",
    };
    expect(readArtifactPrompt({ source: port1, data }, port1)).toEqual({
      prompt: "Go",
      conversation: "thread:R-1.v2_a-b",
    });
    for (const conversation of ["", "a b", "x".repeat(65), "a/b", 3])
      expect(
        readArtifactPrompt(
          { source: port1, data: { ...data, conversation } },
          port1,
        ),
      ).toBeNull();
    port1.close();
    port2.close();
  });

  it("accepts only the exact frame and forwards only its prompt", () => {
    const { port1, port2 } = new MessageChannel();
    const data = {
      type: ARTIFACT_PROMPT_TYPE,
      prompt: "Refresh the dashboard",
      agentId: "other",
      sessionId: "other",
    };
    expect(readArtifactPrompt({ source: port1, data }, port1)).toEqual({
      prompt: data.prompt,
    });
    expect(readArtifactPrompt({ source: port2, data }, port1)).toBeNull();
    expect(readArtifactPrompt({ source: port1, data }, null)).toBeNull();
    port1.close();
    port2.close();
  });

  it.each([
    {},
    { type: "artifact.request", prompt: "Old API" },
    { type: ARTIFACT_PROMPT_TYPE, prompt: "  " },
    { type: ARTIFACT_PROMPT_TYPE, prompt: 123 },
    {
      type: ARTIFACT_PROMPT_TYPE,
      prompt: "x".repeat(ARTIFACT_PROMPT_MAX_LENGTH + 1),
    },
  ])("rejects malformed or oversized messages", (data) => {
    const { port1, port2 } = new MessageChannel();
    expect(readArtifactPrompt({ source: port1, data }, port1)).toBeNull();
    port1.close();
    port2.close();
  });
});
