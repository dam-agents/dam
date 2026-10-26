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
  "/agents/new",
  "/artifacts",
];

describe("route round-trip", () => {
  it.each(canonicalPaths)("routeToPath(parseRoute(%s)) is identity", (path) => {
    expect(routeToPath(parseRoute(path))).toBe(path);
  });

  it.each([
    "/sandboxes",
    "/sandboxes/",
    "/sandboxes/new",
    "/inbox",
    "/experiments",
    "/experiments/new",
  ])("sends the retired %s to Home", (path) => {
    expect(parseRoute(path).view).toBe("home");
  });

  // TEST_SCENARIO: the per-kind destinations are gone, and so are their paths. An unknown path is Home like any other, rather than something the router still carries a case for.
  it.each([
    "/coding-agents",
    "/coding-agents/new",
    "/knowledge-bases",
    "/knowledge-bases/kb-1",
    "/knowledge-bases/kb-1/settings",
  ])("no longer knows %s", (path) => {
    expect(parseRoute(path).view).toBe("home");
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
