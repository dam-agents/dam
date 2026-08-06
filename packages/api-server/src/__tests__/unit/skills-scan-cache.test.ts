import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Skill } from "api-server-api";
import { createScanCache } from "../../modules/skills/infrastructure/scan-cache.js";

const TTL_MS = 5 * 60 * 1000;
const URL = "https://github.com/acme/skills";
const SHARED = { kind: "shared" } as const;
const ALICE = { kind: "owner", owner: "alice" } as const;
const BOB = { kind: "owner", owner: "bob" } as const;

function skill(name: string): Skill {
  return {
    source: URL,
    name,
    description: `${name} desc`,
    version: "abc1234",
    contentHash: `hash-${name}`,
  };
}

/** Silences the cache's stderr trace; the calls themselves aren't the contract. */
const quiet = () => createScanCache(() => {});

describe("skills scan cache", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("stamps a miss with the read it just performed", async () => {
    const cache = quiet();
    vi.setSystemTime(1_000_000);

    const res = await cache.scan(SHARED, URL, undefined, async () => [
      skill("a"),
    ]);

    expect(res.skills.map((s) => s.name)).toEqual(["a"]);
    expect(res.scannedAt).toBe(1_000_000);
  });

  it("serves a hit with the original read, not the moment of the hit", async () => {
    const cache = quiet();
    const scanner = vi.fn(async () => [skill("a")]);
    vi.setSystemTime(1_000_000);
    await cache.scan(SHARED, URL, undefined, scanner);

    vi.setSystemTime(1_000_000 + TTL_MS - 1);
    const hit = await cache.scan(SHARED, URL, undefined, scanner);

    expect(hit.scannedAt).toBe(1_000_000);
    expect(scanner).toHaveBeenCalledTimes(1);
  });

  it("re-reads and re-stamps once the entry expires", async () => {
    const cache = quiet();
    vi.setSystemTime(1_000_000);
    await cache.scan(SHARED, URL, undefined, async () => [skill("a")]);

    vi.setSystemTime(1_000_000 + TTL_MS);
    const fresh = await cache.scan(SHARED, URL, undefined, async () => [
      skill("b"),
    ]);

    expect(fresh.skills.map((s) => s.name)).toEqual(["b"]);
    expect(fresh.scannedAt).toBe(1_000_000 + TTL_MS);
  });

  it("caches nothing when the scanner throws, leaving no stamp to serve", async () => {
    const cache = quiet();
    vi.setSystemTime(1_000_000);

    await expect(
      cache.scan(SHARED, URL, undefined, async () => {
        throw new Error("upstream down");
      }),
    ).rejects.toThrow("upstream down");

    const scanner = vi.fn(async () => [skill("a")]);
    vi.setSystemTime(2_000_000);
    const res = await cache.scan(SHARED, URL, undefined, scanner);

    expect(scanner).toHaveBeenCalledTimes(1);
    expect(res.scannedAt).toBe(2_000_000);
  });

  it("keeps a fresh entry intact when a later scan of another key throws", async () => {
    const cache = quiet();
    vi.setSystemTime(1_000_000);
    await cache.scan(SHARED, URL, undefined, async () => [skill("a")]);

    await expect(
      cache.scan(SHARED, URL, "sub", async () => {
        throw new Error("upstream down");
      }),
    ).rejects.toThrow();

    const scanner = vi.fn(async () => [skill("z")]);
    const hit = await cache.scan(SHARED, URL, undefined, scanner);

    expect(hit.scannedAt).toBe(1_000_000);
    expect(scanner).not.toHaveBeenCalled();
  });

  it("keys on (gitUrl, path) so one subdir's scan never answers another's", async () => {
    const cache = quiet();
    vi.setSystemTime(1_000_000);
    await cache.scan(SHARED, URL, undefined, async () => [skill("root")]);

    const res = await cache.scan(SHARED, URL, "packages/skills", async () => [
      skill("nested"),
    ]);

    expect(res.skills.map((s) => s.name)).toEqual(["nested"]);
  });

  it("invalidation forces the next scan upstream", async () => {
    const cache = quiet();
    vi.setSystemTime(1_000_000);
    await cache.scan(SHARED, URL, undefined, async () => [skill("a")]);

    cache.invalidate(URL, undefined);

    vi.setSystemTime(1_100_000);
    const res = await cache.scan(SHARED, URL, undefined, async () => [
      skill("b"),
    ]);

    expect(res.skills.map((s) => s.name)).toEqual(["b"]);
    expect(res.scannedAt).toBe(1_100_000);
  });

  it("answers a credentialed scan only to the owner who produced it, and lets the others keep their own", async () => {
    const cache = quiet();
    vi.setSystemTime(1_000_000);
    await cache.scan(ALICE, URL, undefined, async () => [skill("alice")]);

    const bobScan = vi.fn(async () => [skill("bob")]);
    const sharedScan = vi.fn(async () => [skill("public")]);
    await cache.scan(BOB, URL, undefined, bobScan);
    await cache.scan(SHARED, URL, undefined, sharedScan);

    expect(bobScan).toHaveBeenCalledTimes(1);
    expect(sharedScan).toHaveBeenCalledTimes(1);

    // Neither reader displaced Alice: a second user of one private source is
    // not an eviction, or the cache stops hitting for everyone sharing it.
    const rescan = vi.fn(async () => [skill("refetched")]);
    const hit = await cache.scan(ALICE, URL, undefined, rescan);

    expect(hit.skills.map((s) => s.name)).toEqual(["alice"]);
    expect(rescan).not.toHaveBeenCalled();
  });

  it("invalidation drops every scope's entry for the source", async () => {
    const cache = quiet();
    vi.setSystemTime(1_000_000);
    await cache.scan(ALICE, URL, undefined, async () => [skill("alice")]);
    await cache.scan(SHARED, URL, undefined, async () => [skill("public")]);

    cache.invalidate(URL, undefined);

    const aliceScan = vi.fn(async () => [skill("a2")]);
    const sharedScan = vi.fn(async () => [skill("s2")]);
    await cache.scan(ALICE, URL, undefined, aliceScan);
    await cache.scan(SHARED, URL, undefined, sharedScan);

    expect(aliceScan).toHaveBeenCalledTimes(1);
    expect(sharedScan).toHaveBeenCalledTimes(1);
  });
});
