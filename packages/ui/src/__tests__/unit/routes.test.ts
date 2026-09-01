import { describe, expect, it } from "vitest";

import { parseRoute, routeToPath } from "../../modules/platform/lib/routes.js";

const canonicalPaths = [
  "/",
  "/chat/agent-1",
  "/chat/agent-1/sess-1",
  "/settings",
  "/settings/connections",
  "/terms",
  "/telegram/bind",
  "/slack/bind",
  "/sandboxes/sb-1",
  "/sandboxes/sb-1/connections",
  "/coding-agents",
  "/coding-agents/new",
  "/experiments",
  "/experiments/new",
  "/knowledge-bases",
  "/knowledge-bases/new",
  "/knowledge-bases/kb-1",
  "/knowledge-bases/kb-1/settings",
  "/artifacts",
];

describe("route round-trip", () => {
  it.each(canonicalPaths)("routeToPath(parseRoute(%s)) is identity", (path) => {
    expect(routeToPath(parseRoute(path))).toBe(path);
  });

  it.each(["/sandboxes", "/sandboxes/", "/sandboxes/new", "/inbox"])(
    "sends the retired %s to Home",
    (path) => {
      expect(parseRoute(path).view).toBe("home");
    },
  );

  it("parses /knowledge-bases/new as its setup page, not a KB id", () => {
    expect(parseRoute("/knowledge-bases/new").view).toBe("knowledge-base-new");
  });
});

describe("chat route", () => {
  it("carries the session a link points at", () => {
    expect(parseRoute("/chat/agent-1/sess-1")).toEqual({
      view: "chat",
      agent: "agent-1",
      session: "sess-1",
    });
  });

  it("leaves the session absent when the path names only the agent", () => {
    expect(parseRoute("/chat/agent-1")).toEqual({
      view: "chat",
      agent: "agent-1",
    });
  });

  it("round-trips ids that need escaping", () => {
    const path = routeToPath({
      view: "chat",
      agent: "agent/1",
      session: "sess 1",
    });
    expect(parseRoute(path)).toEqual({
      view: "chat",
      agent: "agent/1",
      session: "sess 1",
    });
  });

  it("tolerates a trailing slash", () => {
    expect(parseRoute("/chat/agent-1/sess-1/")).toEqual({
      view: "chat",
      agent: "agent-1",
      session: "sess-1",
    });
  });
});
