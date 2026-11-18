import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSessionMediaRoot } from "../session-media-store.js";

/**
 * TEST_OVERVIEW: the session media store keeps a Session Transcript's image
 * and audio bytes on disk, by content, and fails closed.
 *
 * The root deletes what an earlier process left, each runtime's store has a
 * folder of its own, a block's bytes come back by the key `put` answered,
 * and a write or read that fails answers null rather than throwing into the
 * transcript.
 */

const dirs: string[] = [];

function rootDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "session-media-root-"));
  dirs.push(dir);
  return join(dir, "media");
}

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("session media store", () => {
  /**
   * TEST_SCENARIO: Bytes put for a Session come back by their key, and the
   * same bytes put twice share one key and one file.
   */
  it("should give the bytes back by the key it answered, once per content", () => {
    const dir = rootDir();
    const store = createSessionMediaRoot({ dir, log: () => {} }).store();

    const key = store.put("s1", "IMAGE-BYTES");
    expect(key).not.toBeNull();
    expect(store.put("s1", "IMAGE-BYTES")).toBe(key);
    expect(store.get("s1", key!)).toBe("IMAGE-BYTES");
    expect(store.get("s2", key!)).toBeNull();
    expect(
      readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) =>
        e.isFile(),
      ),
    ).toHaveLength(1);
  });

  /**
   * TEST_SCENARIO: Dropping one key removes that file only, and forgetting a
   * Session removes all of its bytes but no other Session's.
   */
  it("should drop one file, and forget one Session's files", () => {
    const store = createSessionMediaRoot({
      dir: rootDir(),
      log: () => {},
    }).store();
    const a = store.put("s1", "A")!;
    const b = store.put("s1", "B")!;
    const c = store.put("s2", "C")!;

    store.drop("s1", a);
    expect(store.get("s1", a)).toBeNull();
    expect(store.get("s1", b)).toBe("B");

    store.forget("s1");
    expect(store.get("s1", b)).toBeNull();
    expect(store.get("s2", c)).toBe("C");
  });

  /**
   * TEST_SCENARIO: The logs that referred to files an earlier process wrote
   * died with it, so making the root deletes them; and two runtimes' stores
   * never share a folder, so clearing one leaves the other's bytes.
   */
  it("should start empty and keep each runtime's store apart", () => {
    const dir = rootDir();
    mkdirSync(join(dir, "left-over"), { recursive: true });
    writeFileSync(join(dir, "left-over", "file"), "old");

    const root = createSessionMediaRoot({ dir, log: () => {} });
    expect(readdirSync(join(dir, ".."))).toEqual([]);

    const first = root.store();
    const second = root.store();
    const key = first.put("s1", "X")!;
    second.put("s1", "X");
    first.clear();

    expect(first.get("s1", key)).toBeNull();
    expect(second.get("s1", key)).toBe("X");
  });

  /**
   * TEST_SCENARIO: A disk that refuses the write, here because a file stands
   * where the store's folder should be, answers null and logs why, so the
   * transcript keeps the bytes inline instead of losing them.
   */
  it("should answer null when it cannot write", () => {
    const dir = rootDir();
    const logs: string[] = [];
    const store = createSessionMediaRoot({
      dir,
      log: (msg) => logs.push(msg),
    }).store();
    writeFileSync(dir, "not a folder");

    expect(store.put("s1", "X")).toBeNull();
    expect(logs).toHaveLength(1);
  });
});
