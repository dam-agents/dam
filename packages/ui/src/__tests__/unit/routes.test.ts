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
  "/connections/secret",
  "/sandboxes/sb-1",
  "/sandboxes/sb-1/services",
  "/starter-kits/platform/code-reviewer",
  "/starter-kits/link/acme/shared-kit",
  "/analytics",
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
    "/agents/new",
    "/starter-kits/software",
  ])("sends the retired %s to Home", (path) => {
    expect(parseRoute(path).view).toBe("home");
  });

  // TEST_SCENARIO: the sidebar's Artifacts and Starter kits each open their own page, and a link to either page lands there.
  it("opens the Artifacts and Starter kits pages", () => {
    expect(parseRoute("/artifacts")).toEqual({ view: "artifacts" });
    expect(parseRoute("/starter-kits")).toEqual({ view: "starter-kits" });
    expect(routeToPath({ view: "artifacts" })).toBe("/artifacts");
    expect(routeToPath({ view: "starter-kits" })).toBe("/starter-kits");
  });

  // TEST_SCENARIO: a kit from a link is addressed by its repository, so a teammate can share the platform page itself: /starter-kits/link/<owner>/<repo> opens the kit modal for that repository, keeping the slash between owner and repository.
  it("opens the kit modal for a kit from a link", () => {
    expect(parseRoute("/starter-kits/link/acme/shared-kit")).toEqual({
      view: "starter-kit",
      catalog: "link",
      kit: "acme/shared-kit",
    });
    expect(
      routeToPath({ view: "starter-kit", catalog: "link", kit: "acme/kit.v2" }),
    ).toBe("/starter-kits/link/acme/kit.v2");
  });

  it("opens the kit modal for a retired kit setup link", () => {
    expect(parseRoute("/starter-kits/platform/code-reviewer/new")).toEqual({
      view: "starter-kit",
      catalog: "platform",
      kit: "code-reviewer",
    });
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
