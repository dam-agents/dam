/**
 * TEST_OVERVIEW: The api-server serves while the object store is down. The
 * bucket is provisioned in the background, with no budget, so a replica that
 * starts during an outage does not exit; and a store call that cannot reach
 * the store fails with a SERVICE_UNAVAILABLE error that says why, while every
 * other store error passes through unchanged.
 */
import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import type { ArtifactStore } from "../../modules/artifacts/domain/artifact-store.js";
import { withUnreachableAsUnavailable } from "../../modules/artifacts/infrastructure/unreachable-artifact-store.js";
import { provisionBucketInBackground } from "../../modules/artifacts/services/provision-bucket.js";

const connError = (code: string) =>
  Object.assign(new Error(`read ${code}`), { code });

function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    elapsed: () => t,
  };
}

function recordingLog() {
  const lines: { level: string; msg: string }[] = [];
  return {
    lines,
    log: {
      info: (msg: string) => lines.push({ level: "info", msg }),
      warn: (msg: string) => lines.push({ level: "warn", msg }),
      error: (msg: string) => lines.push({ level: "error", msg }),
    },
  };
}

function stubStore(overrides: Partial<ArtifactStore> = {}): ArtifactStore {
  return {
    put: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    getStream: vi.fn().mockResolvedValue(null),
    getRange: vi.fn().mockResolvedValue(null),
    exists: vi.fn().mockResolvedValue(false),
    head: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(undefined),
    presignUpload: vi.fn().mockResolvedValue(null),
    presignDownload: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe("provisionBucketInBackground", () => {
  /**
   * TEST_SCENARIO: A node drain keeps the store down for ten minutes, far past
   * the two minutes the boot used to wait. Provisioning keeps trying, with the
   * delay capped at 30 s, and succeeds once the store answers, without ever
   * rejecting.
   */
  it("keeps trying past the old boot budget until the store answers", async () => {
    const clock = fakeClock();
    const { lines, log } = recordingLog();
    let calls = 0;
    const ensureReady = async () => {
      calls++;
      if (clock.elapsed() < 10 * 60_000) throw connError("ECONNRESET");
    };

    await expect(
      provisionBucketInBackground(ensureReady, { log, ...clock }),
    ).resolves.toBeUndefined();

    expect(clock.elapsed()).toBeGreaterThanOrEqual(10 * 60_000);
    expect(calls).toBeGreaterThan(20);
    const warns = lines.filter((l) => l.level === "warn");
    expect(warns.at(-1)!.msg).toContain("retrying in 30000ms");
    expect(lines.at(-1)).toEqual({
      level: "info",
      msg: "object storage: the bucket is ready",
    });
  });

  /**
   * TEST_SCENARIO: The store answers but refuses the bucket, such as with
   * restricted credentials. Retrying cannot fix that, so it is logged once as
   * an error and the promise still resolves: the boot is never failed from
   * here.
   */
  it("logs a failure that is not about reaching the store and stops", async () => {
    const { lines, log } = recordingLog();
    let calls = 0;
    const ensureReady = async () => {
      calls++;
      throw new Error("AccessDenied");
    };

    await expect(
      provisionBucketInBackground(ensureReady, { log, ...fakeClock() }),
    ).resolves.toBeUndefined();

    expect(calls).toBe(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.level).toBe("error");
    expect(lines[0]!.msg).toContain("AccessDenied");
  });
});

describe("withUnreachableAsUnavailable", () => {
  /**
   * TEST_SCENARIO: The store is down when a person opens an artifact. The
   * read fails with SERVICE_UNAVAILABLE that names the object store, and keeps
   * the connection error as its cause for the logs.
   */
  it("turns a connection error into SERVICE_UNAVAILABLE", async () => {
    const reset = connError("ECONNRESET");
    const store = withUnreachableAsUnavailable(
      stubStore({ get: vi.fn().mockRejectedValue(reset) }),
    );

    const err = await store.get("k").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(TRPCError);
    expect(err).toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      message: expect.stringContaining("object store cannot be reached"),
      cause: reset,
    });
  });

  /**
   * TEST_SCENARIO: The store comes back. The same wrapped store answers again
   * with no restart, because nothing is cached about the outage.
   */
  it("answers again once the store is back", async () => {
    const put = vi
      .fn()
      .mockRejectedValueOnce(connError("ECONNREFUSED"))
      .mockResolvedValueOnce(undefined);
    const store = withUnreachableAsUnavailable(stubStore({ put }));
    const input = {
      key: "k",
      content: Buffer.from("x"),
      contentType: "text/plain",
    };

    await expect(store.put(input)).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
    await expect(store.put(input)).resolves.toBeUndefined();
    expect(put).toHaveBeenCalledTimes(2);
  });

  /**
   * TEST_SCENARIO: An error that is not about reaching the store, such as a
   * refused signature, is passed through as it came.
   */
  it("passes any other error through unchanged", async () => {
    const denied = new Error("AccessDenied");
    const store = withUnreachableAsUnavailable(
      stubStore({ head: vi.fn().mockRejectedValue(denied) }),
    );

    await expect(store.head("k")).rejects.toBe(denied);
  });
});
