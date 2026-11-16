import { describe, expect, it, vi } from "vitest";

import { createProvisioningGuard } from "../../modules/assistants/services/provisioning-guard.js";

/**
 * TEST_OVERVIEW: the guard the request path starts its provisioning behind. A
 * request never waits for the create: it hands the work over and is answered,
 * one attempt runs per owner at a time on this replica, and a failure is left to
 * the next attempt rather than raised into a request that has already gone out.
 */
describe("the request-path provisioning guard", () => {
  // TEST_SCENARIO: the create hangs — a slow store, a stuck admission — and the call that started it still returns at once, so nobody's page waits for it.
  it("returns before the work it starts", () => {
    const guard = createProvisioningGuard();
    let release: () => void = () => {};
    const work = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const started = Date.now();
    guard.start("alice", work);
    expect(Date.now() - started).toBeLessThan(50);
    expect(work).toHaveBeenCalledTimes(1);
    expect(guard.running("alice")).toBe(true);
    release();
  });

  // TEST_SCENARIO: a person opening three tabs at once hands the work over three times and one attempt runs; the other owners are unaffected.
  it("runs one attempt per owner at a time", async () => {
    const guard = createProvisioningGuard();
    const work = vi.fn(async () => {});
    let release: () => void = () => {};
    const hanging = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    guard.start("alice", hanging);
    guard.start("alice", hanging);
    guard.start("bob", work);
    expect(hanging).toHaveBeenCalledTimes(1);
    expect(work).toHaveBeenCalledTimes(1);
    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(guard.running("alice")).toBe(false);
    guard.start("alice", work);
    expect(work).toHaveBeenCalledTimes(2);
  });

  // TEST_SCENARIO: the attempt fails, as a create that could not reach the store does; nothing is raised into the request, and the guard is free again for the next one.
  it("swallows a failure and frees the owner", async () => {
    const guard = createProvisioningGuard();
    const failing = vi.fn(async () => {
      throw new Error("store is down");
    });
    expect(() => guard.start("alice", failing)).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
    expect(guard.running("alice")).toBe(false);
  });
});
