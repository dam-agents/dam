/**
 * TEST_OVERVIEW: The api-server serves while the object store is down. The
 * bucket is provisioned in the background, with no budget, so a replica that
 * starts during an outage does not exit; and a store call that fails because
 * the store is not serving (no connection, a 5xx, an S3 "try again" error)
 * fails with a SERVICE_UNAVAILABLE error that says why, while every other
 * store error passes through unchanged.
 */
import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import type { ArtifactStore } from "../../modules/artifacts/domain/artifact-store.js";
import { isStoreUnavailable } from "../../modules/artifacts/infrastructure/store-unavailable.js";
import { withUnreachableAsUnavailable } from "../../modules/artifacts/infrastructure/unreachable-artifact-store.js";
import { provisionBucketInBackground } from "../../modules/artifacts/services/provision-bucket.js";

const connError = (code: string) =>
  Object.assign(new Error(`read ${code}`), { code });

const storeAnswer = (name: string, httpStatusCode: number) =>
  Object.assign(new Error(name), {
    name,
    $metadata: { httpStatusCode },
  });

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
      provisionBucketInBackground(ensureReady, {
        retryable: isStoreUnavailable,
        log,
        ...clock,
      }),
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
   * TEST_SCENARIO: The store's proxy answers 503 while the store starts, then
   * the store throttles once. Both are answers that mean "try again", so
   * provisioning goes on until the bucket is ready.
   */
  it("keeps trying while the store answers a 5xx or asks to slow down", async () => {
    const { lines, log } = recordingLog();
    const answers = [
      storeAnswer("ServiceUnavailable", 503),
      storeAnswer("Unknown", 502),
      storeAnswer("SlowDown", 503),
    ];
    let calls = 0;
    const ensureReady = async () => {
      const answer = answers[calls++];
      if (answer) throw answer;
    };

    await provisionBucketInBackground(ensureReady, {
      retryable: isStoreUnavailable,
      log,
      ...fakeClock(),
    });

    expect(calls).toBe(4);
    expect(lines.at(-1)!.msg).toBe("object storage: the bucket is ready");
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
      provisionBucketInBackground(ensureReady, {
        retryable: isStoreUnavailable,
        log,
        ...fakeClock(),
      }),
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
   * TEST_SCENARIO: The store's proxy answers 503 while the store is down. The
   * call fails with SERVICE_UNAVAILABLE as a refused connection does.
   */
  it("turns a store 5xx into SERVICE_UNAVAILABLE", async () => {
    const store = withUnreachableAsUnavailable(
      stubStore({
        exists: vi
          .fn()
          .mockRejectedValue(storeAnswer("ServiceUnavailable", 503)),
      }),
    );

    await expect(store.exists("k")).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
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

describe("isStoreUnavailable", () => {
  /**
   * TEST_SCENARIO: Each kind of failure a store call can end in. Only a
   * failed connection, a 5xx and the S3 "try again" errors mean the store is
   * not serving now; a 4xx answer, a refusal and anything that is not an
   * error object do not.
   */
  it("matches only failures that mean the store is not serving now", () => {
    const cases: [unknown, boolean][] = [
      [connError("ECONNRESET"), true],
      [new Error("wrapped", { cause: connError("ECONNREFUSED") }), true],
      [connError("ETIMEDOUT"), true],
      [storeAnswer("ServiceUnavailable", 503), true],
      [storeAnswer("SlowDown", 503), true],
      [storeAnswer("RequestTimeout", 400), true],
      [storeAnswer("InternalError", 500), true],
      [storeAnswer("Unknown", 502), true],
      [storeAnswer("Unknown", 504), true],
      [storeAnswer("AccessDenied", 403), false],
      [storeAnswer("InvalidAccessKeyId", 403), false],
      [storeAnswer("NoSuchBucket", 404), false],
      [storeAnswer("BadRequest", 400), false],
      [new Error("boom"), false],
      ["ECONNRESET", false],
      [null, false],
      [undefined, false],
    ];
    for (const [err, expected] of cases)
      expect([err, isStoreUnavailable(err)]).toEqual([err, expected]);
  });
});
