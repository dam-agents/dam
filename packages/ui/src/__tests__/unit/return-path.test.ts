import { describe, expect, it, vi } from "vitest";

import {
  type Interstitial,
  type LocationLike,
  rememberReturnPath,
  resolveReturnPath,
  resolveReturnPathname,
  type ReturnPathStore,
  takeReturnPath,
} from "../../lib/return-path.js";

const ORIGIN = "https://app.example";

interface FakeStore extends ReturnPathStore {
  isEmpty(): boolean;
  /** Stand-in for a tampered-with sessionStorage, whose slot names the module owns. */
  tamper(value: string): void;
}

function fakeStore(): FakeStore {
  const entries = new Map<string, string>();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
    removeItem: (key) => void entries.delete(key),
    isEmpty: () => entries.size === 0,
    tamper: (value) => {
      for (const key of entries.keys()) entries.set(key, value);
    },
  };
}

function location(pathname: string, search = "", hash = ""): LocationLike {
  return { origin: ORIGIN, pathname, search, hash };
}

const BIND_LINK = location("/slack/bind", "?flow=abc-123");
const resolvePath = (value: string) => resolveReturnPath(value, ORIGIN);

describe("resolveReturnPath", () => {
  it("keeps same-origin destinations whole — the bind flow id lives in the query", () => {
    expect(resolvePath("/")).toBe("/");
    expect(resolvePath("/slack/bind?flow=abc-123")).toBe(
      "/slack/bind?flow=abc-123",
    );
    expect(resolvePath("/telegram/bind?flow=xyz#top")).toBe(
      "/telegram/bind?flow=xyz#top",
    );
    expect(resolvePath("/settings/connections#tokens")).toBe(
      "/settings/connections#tokens",
    );
    expect(resolvePath("/sandboxes/a%20b/channels")).toBe(
      "/sandboxes/a%20b/channels",
    );
  });

  it("bars the interstitials themselves, not paths that share their prefix", () => {
    expect(resolvePath("/auth/callback")).toBe(null);
    expect(resolvePath("/auth/callback?code=abc&state=xyz")).toBe(null);
    expect(resolvePath("/terms")).toBe(null);
    expect(resolvePath("/terms-of-service")).toBe("/terms-of-service");
    expect(resolvePath("/termsx")).toBe("/termsx");
    expect(resolvePath("/terms/sub")).toBe("/terms/sub");
    expect(resolvePath("/auth/callbackx")).toBe("/auth/callbackx");
  });

  it("rejects anything that would leave the origin", () => {
    expect(resolvePath("https://evil.example/")).toBe(null);
    expect(resolvePath("//evil.example/")).toBe(null);
    expect(resolvePath("/\\evil.example/")).toBe(null);
    expect(resolvePath("javascript:alert(1)")).toBe(null);
    expect(resolvePath("data:text/html,<script>1</script>")).toBe(null);
    // Same origin, but no hierarchical path to navigate to.
    expect(resolvePath(`blob:${ORIGIN}/9c2f-uuid`)).toBe(null);
  });

  it("reads an empty or blank value as the dashboard, like the parser does", () => {
    expect(resolvePath("")).toBe("/");
    expect(resolvePath(" ")).toBe("/");
  });

  // The three classes below are all the same defect — text the parser rewrites
  // before the browser acts on it. They stay as tests because each one reached
  // a different wrong destination before the parser became the authority.
  it.each(["\t", "\n", "\r"])(
    "sees through an interior %j, dropped mid-URL",
    (control) => {
      expect(resolvePath(`/${control}/evil.example`)).toBe(null);
      expect(resolvePath(`/${control}\\evil.example`)).toBe(null);
      expect(resolvePath(`/${control}terms`)).toBe(null);
    },
  );

  it.each(["\t", "\n", "\r", "\f", "\v", "\0", " "])(
    "sees through a trailing %j, trimmed at the ends",
    (control) => {
      expect(resolvePath(`/terms${control}`)).toBe(null);
      expect(resolvePath(`/auth/callback${control}`)).toBe(null);
      expect(resolvePath(`${control}/terms`)).toBe(null);
    },
  );

  it.each([
    "/a/../terms",
    "/./terms",
    "/a/b/../../terms",
    "/terms/../terms",
    "/%2e%2e/terms",
    "/%2E./terms",
    "/foo/../auth/callback",
    "/auth/./callback",
  ])("sees through dot segments in %j, collapsed on resolve", (value) => {
    expect(resolvePath(value)).toBe(null);
  });

  it("hands back the parser's canonical form, so callers act on what was judged", () => {
    expect(resolvePath("/a/../settings/usage")).toBe("/settings/usage");
    expect(resolvePath("/settings/./usage")).toBe("/settings/usage");
  });

  // Collapsing dot segments can leave a path that begins with "//" — same origin
  // once, another origin when the result is used as a reference again. The
  // returned text has to mean what it was judged to mean.
  it.each([
    "/a/..//evil.example",
    "/..//evil.example",
    "/a/b/../..//evil.example",
    "/\t..//evil.example",
    "/a/..//evil.example?x=1",
  ])("rejects %j, whose resolved path reads as another origin", (value) => {
    expect(resolvePath(value)).toBe(null);
    expect(resolveReturnPathname(value, ORIGIN)).toBe(null);
  });

  // Boot and the Terms-accept navigation both run through here, so an
  // unparseable value has to read as "no destination", never throw.
  it.each(["//%00evil.example", "/a/..//%00evil.example", "/%00/..//x"])(
    "rejects %j without throwing",
    (value) => {
      expect(() => resolvePath(value)).not.toThrow();
      expect(resolvePath(value)).toBe(null);
    },
  );
});

describe("resolveReturnPathname", () => {
  it("drops the query and fragment routing must not see", () => {
    expect(resolveReturnPathname("/settings/connections?oauth=1", ORIGIN)).toBe(
      "/settings/connections",
    );
    expect(resolveReturnPathname("/sandboxes/abc/channels#x", ORIGIN)).toBe(
      "/sandboxes/abc/channels",
    );
    expect(resolveReturnPathname("/a/../terms", ORIGIN)).toBe(null);
  });
});

describe("remember/take round-trip", () => {
  it("hands the bind deep link back once, then falls back to the dashboard", () => {
    const store = fakeStore();
    rememberReturnPath("login", BIND_LINK, store);
    expect(takeReturnPath("login", store, ORIGIN)).toBe(
      "/slack/bind?flow=abc-123",
    );
    expect(takeReturnPath("login", store, ORIGIN)).toBe("/");
  });

  it("keeps the login and terms destinations in separate slots", () => {
    const store = fakeStore();
    rememberReturnPath("login", BIND_LINK, store);
    rememberReturnPath("terms", location("/settings/usage"), store);
    expect(takeReturnPath("login", store, ORIGIN)).toBe(
      "/slack/bind?flow=abc-123",
    );
    expect(takeReturnPath("terms", store, ORIGIN)).toBe("/settings/usage");
  });

  it("clears a stale destination when the current location is an interstitial", () => {
    const store = fakeStore();
    rememberReturnPath("login", BIND_LINK, store);
    rememberReturnPath("login", location("/terms"), store);
    expect(takeReturnPath("login", store, ORIGIN)).toBe("/");
  });

  it.each<[string, string]>([
    ["off-origin", "https://evil.example/steal"],
    ["protocol-relative", "//evil.example/steal"],
    ["control-character", "/\t/evil.example"],
    ["dot-segment", "/a/../terms"],
  ])("drops a tampered %s destination on the way out", (_label, tampered) => {
    const store = fakeStore();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    rememberReturnPath("terms", BIND_LINK, store);
    store.tamper(tampered);
    expect(takeReturnPath("terms", store, ORIGIN)).toBe("/");
    expect(warn).toHaveBeenCalled();
    expect(store.isEmpty()).toBe(true);
    warn.mockRestore();
  });

  it.each<Interstitial>(["login", "terms"])(
    "stores the canonical form for %s, not the raw text",
    (which) => {
      const store = fakeStore();
      rememberReturnPath(which, location("/a/../settings/usage"), store);
      expect(takeReturnPath(which, store, ORIGIN)).toBe("/settings/usage");
    },
  );
});
