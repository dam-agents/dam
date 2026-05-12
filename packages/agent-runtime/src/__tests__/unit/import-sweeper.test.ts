import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sweepStaging } from "../../modules/import/sweeper.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sweep-home-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("sweepStaging", () => {
  it("removes a stale staging dir (mtime older than 1h) and keeps a fresh one", async () => {
    const stale = join(home, ".import-staging-stale");
    const fresh = join(home, ".import-staging-fresh");
    mkdirSync(stale);
    mkdirSync(fresh);
    writeFileSync(join(stale, "junk.bin"), "x");
    writeFileSync(join(fresh, "junk.bin"), "x");

    // Backdate the stale dir so its mtime is well past the 1-hour threshold.
    const longAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    utimesSync(stale, longAgo, longAgo);

    const logs: string[] = [];
    await sweepStaging(home, (m) => logs.push(m));

    expect(existsSync(stale)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(logs.some((l) => l.includes(".import-staging-stale"))).toBe(true);
  });

  it("leaves unrelated dirs alone even when they're old", async () => {
    const other = join(home, ".pi");
    mkdirSync(other);
    const longAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    utimesSync(other, longAgo, longAgo);

    await sweepStaging(home, () => {});

    expect(existsSync(other)).toBe(true);
  });
});
