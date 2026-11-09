import { describe, expect, it } from "vitest";

import {
  parseRoute,
  routeToNavigationState,
  routeToPath,
} from "../../modules/platform/lib/routes.js";

const canonicalPaths = [
  "/",
  "/chat/agent-1",
  "/chat/agent-1/sess-1",
  "/artifacts",
  "/artifacts/2f8c1a9e-4b3d-4c5e-8f70-9a1b2c3d4e5f",
  "/settings",
  "/settings/connections",
  "/settings/schedules",
  "/terms",
  "/telegram/bind",
  "/slack/bind",
  "/connections/secret",
  "/sandboxes/sb-1",
  "/sandboxes/sb-1/connections",
  "/starter-kits/platform/code-reviewer",
  "/starter-kits/link/acme/shared-kit",
  "/analytics",
  "/artifacts",
  "/artifacts/art-1",
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

  // TEST_SCENARIO: an artifact's own page is a link to the library with that artifact open, so a private artifact's link in the owner's Slack DM lands on the artifact rather than on a list they then have to search; an id that needs escaping round-trips.
  it("opens the Artifacts page with one artifact", () => {
    expect(parseRoute("/artifacts")).toEqual({ view: "artifacts" });
    expect(parseRoute("/artifacts/2f8c1a9e/")).toEqual({
      view: "artifacts",
      artifactId: "2f8c1a9e",
    });
    expect(parseRoute("/artifacts/a%2Fb")).toEqual({
      view: "artifacts",
      artifactId: "a/b",
    });
    expect(routeToPath({ view: "artifacts", artifactId: "2f8c1a9e" })).toBe(
      "/artifacts/2f8c1a9e",
    );
    expect(routeToPath({ view: "artifacts", artifactId: "a/b" })).toBe(
      "/artifacts/a%2Fb",
    );
    expect(
      routeToNavigationState(parseRoute("/artifacts/2f8c1a9e")),
    ).toMatchObject({ view: "artifacts", artifactId: "2f8c1a9e" });
    expect(routeToNavigationState(parseRoute("/artifacts"))).toMatchObject({
      artifactId: null,
    });
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

  // TEST_SCENARIO: Settings › Profiles has its own tab, and a link may name one profile so its editor opens; ids that need escaping round-trip.
  it("opens Settings › Profiles and a single profile", () => {
    expect(parseRoute("/settings/profiles")).toEqual({
      view: "settings",
      settingsTab: "profiles",
    });
    expect(parseRoute("/settings/profiles/p%2F1")).toEqual({
      view: "settings",
      settingsTab: "profiles",
      profileId: "p/1",
    });
    expect(routeToPath({ view: "settings", settingsTab: "profiles" })).toBe(
      "/settings/profiles",
    );
    expect(
      routeToPath({
        view: "settings",
        settingsTab: "profiles",
        profileId: "p/1",
      }),
    ).toBe("/settings/profiles/p%2F1");
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

describe("artifact page route", () => {
  it("carries the artifact a new tab opens", () => {
    expect(parseRoute("/artifacts/art%2F1")).toEqual({
      view: "artifact",
      artifactId: "art/1",
    });
    expect(routeToPath({ view: "artifact", artifactId: "art/1" })).toBe(
      "/artifacts/art%2F1",
    );
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
