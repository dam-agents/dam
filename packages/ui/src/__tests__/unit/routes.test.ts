import { describe, expect, it } from "vitest";

import { parseRoute, routeToPath } from "../../modules/platform/lib/routes.js";

// One canonical path per view. Non-canonical spellings (/settings/account,
// /sandboxes/:id/setup) intentionally don't round-trip — routeToPath emits the
// canonical form.
const canonicalPaths = [
  "/",
  "/chat/agent-1",
  "/chat/agent-1/sess-1",
  "/settings",
  "/settings/connections",
  "/inbox",
  "/terms",
  "/telegram/bind",
  "/slack/bind",
  "/sandboxes/new",
  "/sandboxes/sb-1",
  "/sandboxes/sb-1/connections",
  "/experiments",
  "/knowledge-bases",
  "/knowledge-bases/kb-1",
  "/knowledge-bases/kb-1/settings",
  "/artifacts",
];

describe("route round-trip", () => {
  it.each(canonicalPaths)("routeToPath(parseRoute(%s)) is identity", (path) => {
    expect(routeToPath(parseRoute(path))).toBe(path);
  });

  // Both traps fail silently if the literal check moves below its regex:
  // the wizard becomes a detail page for an entity named "new".
  it("parses /sandboxes/new as the wizard, not a sandbox id", () => {
    expect(parseRoute("/sandboxes/new").view).toBe("sandbox-new");
  });

  it("parses the legacy /knowledge-bases/new as the wizard, not a KB id", () => {
    expect(parseRoute("/knowledge-bases/new").view).toBe("sandbox-new");
  });
});

// A chat link is the shape a channel reply hands back to a reader, so both
// halves have to survive the round trip through the address bar.
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
