import { describe, expect, it } from "vitest";

import { parseRoute, routeToPath } from "../../modules/platform/lib/routes.js";

const canonicalPaths = [
  "/",
  "/chat/agent-1",
  "/chat/agent-1/sess-1",
  "/settings",
  "/settings/connections",
  "/settings/schedules",
  "/terms",
  "/telegram/bind",
  "/slack/bind",
  "/sandboxes/sb-1",
  "/sandboxes/sb-1/connections",
  "/agents/new",
  "/artifacts",
  "/nonexistent",
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

  // TEST_SCENARIO: an unknown path is Not found and keeps its URL, rather than rendering Home or a default tab under the bad address.
  it.each([
    "/nonexistent",
    "/settings/bogus",
    "/settings/api-keys/extra",
    "/coding-agents",
    "/knowledge-bases/kb-1/settings",
    "/sandboxes/sb-1/bogus",
  ])("does not know %s", (path) => {
    expect(parseRoute(path)).toEqual({ view: "not-found", path });
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
