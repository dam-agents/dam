import { SessionMode } from "api-server-api";
import { describe, expect, it } from "vitest";

import { sessionPath } from "../../modules/sessions/lib/session-path.js";

describe("sessionPath", () => {
  it("names the open session so the URL links to this conversation", () => {
    expect(sessionPath("agent-1", "sess-1", SessionMode.Chat)).toBe(
      "/chat/agent-1/sess-1",
    );
  });

  it("names the agent alone with no session open", () => {
    expect(sessionPath("agent-1", null, null)).toBe("/chat/agent-1");
  });

  it("drops a terminal session, which no reload could re-open", () => {
    // Terminal ids are client-minted PTYs, not resumable conversations.
    expect(sessionPath("agent-1", "pty-1", SessionMode.Terminal)).toBe(
      "/chat/agent-1",
    );
  });
});
