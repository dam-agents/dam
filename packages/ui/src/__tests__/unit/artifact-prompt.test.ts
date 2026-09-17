import {
  ARTIFACT_PROMPT_MAX_LENGTH,
  ARTIFACT_PROMPT_TYPE,
  type LibraryArtifact,
} from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  canSendArtifactPrompt,
  readArtifactPrompt,
} from "../../modules/artifacts/lib/artifact-prompt.js";

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
    expect(canSendArtifactPrompt(artifact, true, "agent", 2)).toBe(true);
  });

  it("disables callbacks when the feature is off", () => {
    expect(canSendArtifactPrompt(artifact, false, "agent", 2)).toBe(false);
  });

  it.each<Partial<LibraryArtifact>>([
    { interactive: false },
    { kind: "jsx" },
    { visibility: "public" },
    { visibility: "restricted" },
    { agentId: null },
    { agentId: "another-agent" },
  ])("refuses an ineligible artifact: %j", (patch) => {
    expect(
      canSendArtifactPrompt({ ...artifact, ...patch }, true, "agent", 2),
    ).toBe(false);
  });

  it("does not send from historical versions or missing contexts", () => {
    expect(canSendArtifactPrompt(artifact, true, "agent", 1)).toBe(false);
    expect(canSendArtifactPrompt(artifact, true, null, 2)).toBe(false);
    expect(canSendArtifactPrompt(null, true, "agent", 2)).toBe(false);
  });
});

describe("artifact frame messages", () => {
  it("accepts only the exact frame and forwards only its prompt", () => {
    const { port1, port2 } = new MessageChannel();
    const data = {
      type: ARTIFACT_PROMPT_TYPE,
      prompt: "Refresh the dashboard",
      agentId: "other",
      sessionId: "other",
    };
    expect(readArtifactPrompt({ source: port1, data }, port1)).toBe(
      data.prompt,
    );
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
