import { SessionMode } from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  nextChatUrl,
  sessionPath,
} from "../../modules/sessions/lib/session-path.js";

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
    expect(sessionPath("agent-1", "pty-1", SessionMode.Terminal)).toBe(
      "/chat/agent-1",
    );
  });
});

describe("nextChatUrl", () => {
  const at = (pathname: string, search = "", hash = "") => ({
    pathname,
    search,
    hash,
  });

  it("moves to the picked session", () => {
    expect(
      nextChatUrl(at("/chat/agent-1/sess-1"), "/chat/agent-1/sess-2"),
    ).toBe("/chat/agent-1/sess-2");
  });

  it("writes nothing for the path already showing", () => {
    expect(nextChatUrl(at("/chat/agent-1"), "/chat/agent-1")).toBeNull();
  });

  it("keeps the query and hash, which belong to the tab", () => {
    expect(
      nextChatUrl(at("/chat/agent-1", "?panel=files", "#msg-3"), "/chat/a/s"),
    ).toBe("/chat/a/s?panel=files#msg-3");
  });
});
