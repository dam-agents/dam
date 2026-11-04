import type { ApiContext } from "api-server-api";
import { appRouter } from "api-server-api/router";
import { markTermsProven, t } from "api-server-api/trpc";
import { describe, expect, it } from "vitest";

/**
 * TEST_OVERVIEW: What the satellite procedures hand to the worker. A fenced
 * procedure requires the registration in its schema, and the handler must pass
 * it on: the check that refuses a removed or replaced registration happens in
 * the worker operation, so a schema that validates an identity the handler then
 * drops is a fence that only looks present. The plain procedures carry none.
 */

const REGISTRATION = "11111111-1111-4111-8111-111111111111";

const MANIFEST = {
  name: "gpu-box",
  maxConcurrent: 2,
  tools: [{ name: "run", inputSchema: {} }],
};

function caller(
  worker: Record<string, (...args: never[]) => Promise<unknown>>,
) {
  const ctx = {
    user: { sub: "alice", scopes: ["satellites:serve"], agentIds: "*" },
    satelliteWorker: worker,
  } as unknown as ApiContext;
  markTermsProven(ctx);
  return t.createCallerFactory(appRouter)(ctx).satellites;
}

/**
 * TEST_SCENARIO: A resume registered through `connectFenced` names the
 * registration it served. If the handler drops it, the worker reads the call as
 * a first registration and takes the name over — the opposite of the refusal a
 * worker that was away must get.
 */
it("passes the registration a fenced connect resumes", async () => {
  const calls: unknown[][] = [];
  const call = caller({
    connect: async (...args: never[]) => {
      calls.push(args);
      return { incarnation: REGISTRATION };
    },
  });

  await call.connectFenced({
    manifest: MANIFEST,
    host: "gpu-box.internal",
    resume: REGISTRATION,
  });

  expect(calls).toEqual([
    ["alice", MANIFEST, "gpu-box.internal", REGISTRATION],
  ]);
});

/** TEST_SCENARIO: A first registration names nothing, and passes nothing on. */
it("registers a fresh worker without a registration", async () => {
  const calls: unknown[][] = [];
  const call = caller({
    connect: async (...args: never[]) => {
      calls.push(args);
      return { incarnation: REGISTRATION };
    },
  });

  await call.connect({ manifest: MANIFEST, host: "gpu-box.internal" });

  expect(calls).toEqual([["alice", MANIFEST, "gpu-box.internal"]]);
});

describe("what a fenced procedure hands the worker", () => {
  function recordingWorker() {
    const calls: Record<string, unknown[][]> = {};
    const record =
      (name: string) =>
      async (...args: never[]) => {
        (calls[name] ??= []).push(args);
        return {};
      };
    return {
      calls,
      worker: {
        connect: record("connect"),
        claim: record("claim"),
        heartbeat: record("heartbeat"),
        report: record("report"),
        drain: record("drain"),
      },
    };
  }

  /**
   * TEST_SCENARIO: Every fenced procedure carries its registration into the
   * operation that writes it, so the same mistake — a schema that requires an
   * identity the handler does not pass — cannot hide in the other four.
   */
  it("passes the registration on the claim, heartbeat, report and drain", async () => {
    const { calls, worker } = recordingWorker();
    const call = caller(worker);
    const outcome = {
      status: "done" as const,
      isError: false,
      exitCode: 0,
      output: "ok",
      images: [],
      truncated: false,
    };

    await call.claimFenced({
      satellite: "gpu-box",
      capacity: 1,
      waitMs: 0,
      incarnation: REGISTRATION,
    });
    await call.heartbeatFenced({
      satellite: "gpu-box",
      running: [1],
      incarnation: REGISTRATION,
    });
    await call.reportFenced({
      satellite: "gpu-box",
      sequence: 1,
      outcome,
      incarnation: REGISTRATION,
    });
    await call.drainFenced({
      satellite: "gpu-box",
      incarnation: REGISTRATION,
    });

    expect(calls.claim?.[0]?.[1]).toMatchObject({ incarnation: REGISTRATION });
    expect(calls.heartbeat?.[0]?.[1]).toMatchObject({
      incarnation: REGISTRATION,
    });
    expect(calls.report?.[0]?.[1]).toMatchObject({ incarnation: REGISTRATION });
    expect(calls.drain?.[0]).toEqual(["alice", "gpu-box", REGISTRATION]);
  });
});
