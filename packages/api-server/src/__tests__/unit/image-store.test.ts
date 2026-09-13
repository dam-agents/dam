// TEST_OVERVIEW: what the image store does besides pulling. Every reconcile of every running agent asks it for the agent's image, so how often it turns to the registry, what it does when the registry does not answer, and which directories it reclaims decide whether a node with twenty agents keeps running through a registry hiccup or takes them all down at once.
import {
  mkdirSync,
  mkdtempSync,
  utimesSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createImageStore } from "../../modules/sandboxes/infrastructure/image-store.js";

const MANIFEST = "application/vnd.oci.image.manifest.v1+json";

function registry(digest = "sha256:" + "a".repeat(64)) {
  const calls: string[] = [];
  const fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${String(url)}`);
    return new Response(JSON.stringify({ mediaType: MANIFEST, layers: [] }), {
      status: 200,
      headers: { "docker-content-digest": digest },
    });
  });
  vi.stubGlobal("fetch", fetch);
  return { calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("resolving a tag", () => {
  // TEST_SCENARIO: two reconciles in a row. The registry is asked once; the second pass finds the answer here.
  it("asks the registry once per window, not once per reconcile", async () => {
    const { calls } = registry();
    const store = createImageStore({
      root: mkdtempSync(join(tmpdir(), "img-")),
      log: () => {},
    });
    await store.ensure("registry.test/repo:tag");
    const afterFirst = calls.length;
    await store.ensure("registry.test/repo:tag");
    expect(afterFirst).toBeGreaterThan(0);
    expect(calls.length).toBe(afterFirst);
  });

  // TEST_SCENARIO: the window has passed and the registry is down. The running agent's image is the one already unpacked, and it stays that.
  it("keeps the last answer when the registry stops answering", async () => {
    vi.useFakeTimers();
    registry();
    const logged: string[] = [];
    const store = createImageStore({
      root: mkdtempSync(join(tmpdir(), "img-")),
      log: (m) => logged.push(m),
    });
    const first = await store.ensure("registry.test/repo:tag");
    vi.setSystemTime(Date.now() + 10 * 60_000);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const again = await store.ensure("registry.test/repo:tag");
    expect(again.rootfs).toBe(first.rootfs);
    expect(logged).toContain("image.resolve.failed");
  });

  // TEST_SCENARIO: nothing is unpacked yet and the registry is down. There is no answer to fall back on, and the failure has to say it is a pull, because the owner is told something different for a pull than for any other failure.
  it("fails as a pull failure when there is nothing to fall back on", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const store = createImageStore({
      root: mkdtempSync(join(tmpdir(), "img-")),
      log: () => {},
    });
    await expect(store.ensure("registry.test/repo:tag")).rejects.toMatchObject({
      name: "ImagePullError",
    });
  });
});

describe("reclaiming images", () => {
  // TEST_SCENARIO: one image untouched for longer than the window, one stamped by a recent reconcile, one half-unpacked directory a crash left behind long ago.
  it("removes what has gone unused for the window and nothing else", async () => {
    const root = mkdtempSync(join(tmpdir(), "img-"));
    const old = new Date(Date.now() - 10 * 86_400_000);
    for (const name of ["stale", "fresh"]) {
      mkdirSync(join(root, name));
      writeFileSync(join(root, name, ".ready"), "");
    }
    utimesSync(join(root, "stale", ".ready"), old, old);
    mkdirSync(join(root, "half"));
    utimesSync(join(root, "half"), old, old);
    await createImageStore({ root, log: () => {} }).prune(7 * 86_400_000);
    expect(existsSync(join(root, "stale"))).toBe(false);
    expect(existsSync(join(root, "half"))).toBe(false);
    expect(existsSync(join(root, "fresh"))).toBe(true);
  });
});
