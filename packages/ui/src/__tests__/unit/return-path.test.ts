import { describe, expect, it, vi } from "vitest";

import {
  type Interstitial,
  isSafeReturnPath,
  rememberReturnPath,
  type ReturnPathStore,
  takeReturnPath,
  toReturnPath,
} from "../../lib/return-path.js";

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

function location(pathname: string, search = "", hash = "") {
  return { pathname, search, hash };
}

const BIND_LINK = location("/slack/bind", "?flow=abc-123");

describe("isSafeReturnPath", () => {
  it("accepts same-origin paths, with query and hash", () => {
    expect(isSafeReturnPath("/")).toBe(true);
    expect(isSafeReturnPath("/slack/bind?flow=abc")).toBe(true);
    expect(isSafeReturnPath("/settings/connections#tokens")).toBe(true);
    // Only the interstitials themselves are barred, not paths that share a prefix.
    expect(isSafeReturnPath("/terms-of-service")).toBe(true);
    expect(isSafeReturnPath("/termsx")).toBe(true);
  });

  it("rejects anything that could leave the origin", () => {
    expect(isSafeReturnPath("https://evil.example/")).toBe(false);
    expect(isSafeReturnPath("//evil.example/")).toBe(false);
    expect(isSafeReturnPath("/\\evil.example/")).toBe(false);
    expect(isSafeReturnPath("javascript:alert(1)")).toBe(false);
    expect(isSafeReturnPath("")).toBe(false);
  });

  it("rejects the interstitials themselves", () => {
    expect(isSafeReturnPath("/auth/callback")).toBe(false);
    expect(isSafeReturnPath("/auth/callback?code=abc&state=xyz")).toBe(false);
    expect(isSafeReturnPath("/terms")).toBe(false);
  });

  // Dropped anywhere in a URL, so an interior one turns a path into a
  // protocol-relative reference: "/<tab>/host" resolves to another origin.
  it.each(["\t", "\n", "\r"])("sees through an interior %j", (control) => {
    expect(isSafeReturnPath(`/${control}/evil.example`)).toBe(false);
    expect(isSafeReturnPath(`/${control}\\evil.example`)).toBe(false);
    expect(isSafeReturnPath(`/${control}terms`)).toBe(false);
  });

  // Trimmed at the ends — the whole C0-plus-space class, not just the three
  // above — so a trailing one would smuggle an interstitial past the check.
  it.each(["\t", "\n", "\r", "\f", "\v", "\0", " "])(
    "sees through a trailing %j on an interstitial",
    (control) => {
      expect(isSafeReturnPath(`/terms${control}`)).toBe(false);
      expect(isSafeReturnPath(`/auth/callback${control}`)).toBe(false);
      expect(isSafeReturnPath(`${control}/terms`)).toBe(false);
    },
  );
});

describe("toReturnPath", () => {
  it("keeps the query — the bind flow id lives there", () => {
    expect(toReturnPath(BIND_LINK)).toBe("/slack/bind?flow=abc-123");
    expect(toReturnPath(location("/telegram/bind", "?flow=xyz", "#top"))).toBe(
      "/telegram/bind?flow=xyz#top",
    );
  });

  it("is null on an interstitial location", () => {
    expect(toReturnPath(location("/auth/callback", "?code=abc"))).toBe(null);
    expect(toReturnPath(location("/terms"))).toBe(null);
  });
});

describe("remember/take round-trip", () => {
  it("hands the bind deep link back once, then falls back to the dashboard", () => {
    const store = fakeStore();
    rememberReturnPath("login", BIND_LINK, store);
    expect(takeReturnPath("login", store)).toBe("/slack/bind?flow=abc-123");
    expect(takeReturnPath("login", store)).toBe("/");
  });

  it("keeps the login and terms destinations in separate slots", () => {
    const store = fakeStore();
    rememberReturnPath("login", BIND_LINK, store);
    rememberReturnPath("terms", location("/settings/usage"), store);
    expect(takeReturnPath("login", store)).toBe("/slack/bind?flow=abc-123");
    expect(takeReturnPath("terms", store)).toBe("/settings/usage");
  });

  it("clears a stale destination when the current location is an interstitial", () => {
    const store = fakeStore();
    rememberReturnPath("login", BIND_LINK, store);
    rememberReturnPath("login", location("/terms"), store);
    expect(takeReturnPath("login", store)).toBe("/");
  });

  it.each<Interstitial>(["login", "terms"])(
    "drops a %s destination that isn't a same-origin path",
    (which) => {
      const store = fakeStore();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      rememberReturnPath(which, BIND_LINK, store);
      store.tamper("https://evil.example/steal");
      expect(takeReturnPath(which, store)).toBe("/");
      expect(warn).toHaveBeenCalled();
      expect(store.isEmpty()).toBe(true);
      warn.mockRestore();
    },
  );
});
