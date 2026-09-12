// TEST_OVERVIEW: fair use over time — the part of sharing that cannot be left to the kernel, because a cgroup weight has no memory and CPU quotas are a rate rather than a budget. What is pinned here is that the policy never stops anyone (a throttled user still gets an idle node to themselves, since a weight only decides who yields), that the penalty is proportional rather than a cliff, and that it decays on its own so nobody has to be let out of it.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createFairShare,
  DEFAULT_WEIGHT,
  MIN_WEIGHT,
  weightFor,
} from "../../modules/sandboxes/services/fair-share.js";

describe("what a user's weight should be", () => {
  it("leaves a user inside their share alone", () => {
    expect(weightFor(0, 2000)).toBe(DEFAULT_WEIGHT);
    expect(weightFor(1999, 2000)).toBe(DEFAULT_WEIGHT);
    expect(weightFor(2000, 2000)).toBe(DEFAULT_WEIGHT);
  });

  // TEST_SCENARIO: a user well over their share. The penalty is the inverse of how far over they are, so it slows them in proportion rather than cutting them off at a threshold.
  it("halves a user at twice their share and quarters them at four times", () => {
    expect(weightFor(4000, 2000)).toBe(50);
    expect(weightFor(8000, 2000)).toBe(25);
  });

  // TEST_SCENARIO: a user who has been using the whole node for a long time. Even then they keep a floor: on a node nobody else wants, a weight of any size still gets the whole machine, and the floor is what stops the busy case becoming starvation.
  it("never takes a user below the floor", () => {
    expect(weightFor(1_000_000, 2000)).toBe(MIN_WEIGHT);
  });

  it("says nothing about a node with no capacity to divide", () => {
    expect(weightFor(5000, 0)).toBe(DEFAULT_WEIGHT);
  });
});

function userCgroup(root: string, name: string, usageUsec: number) {
  mkdirSync(join(root, name), { recursive: true });
  writeFileSync(join(root, name, "cpu.stat"), `usage_usec ${usageUsec}\n`);
  writeFileSync(join(root, name, "cpu.weight"), String(DEFAULT_WEIGHT));
}
const weightOf = (root: string, name: string) =>
  Number(readFileSync(join(root, name, "cpu.weight"), "utf8"));

describe("the controller over several ticks", () => {
  const run = (root: string, clock: () => number) =>
    createFairShare({
      capacityMilli: async () => 4000,
      root,
      now: clock,
      log: () => {},
    });

  // TEST_SCENARIO: two users both wanting the machine — one taking four cores, one taking half of one — on a four-core node. With two of them competing an even split is two cores each, so the heavy one is at twice their share. Five minutes in the average has reached about two thirds of the real rate, so the tilt is real but partial; twenty minutes in it has converged on the half share that twice the fair share earns.
  it("throttles the heavy user and leaves the light one alone", async () => {
    const root = mkdtempSync(join(tmpdir(), "fs-"));
    let clock = 0;
    const fair = run(root, () => clock);
    userCgroup(root, "dam-user-heavy", 0);
    userCgroup(root, "dam-user-light", 0);
    await fair.tick();
    expect(weightOf(root, "dam-user-heavy")).toBe(DEFAULT_WEIGHT);

    for (let i = 1; i <= 20; i++) {
      clock += 15_000;
      userCgroup(root, "dam-user-heavy", i * 4 * 15_000_000);
      userCgroup(root, "dam-user-light", i * 0.5 * 15_000_000);
      await fair.tick();
    }
    expect(weightOf(root, "dam-user-heavy")).toBeLessThan(80);
    expect(weightOf(root, "dam-user-light")).toBe(DEFAULT_WEIGHT);

    for (let i = 21; i <= 80; i++) {
      clock += 15_000;
      userCgroup(root, "dam-user-heavy", i * 4 * 15_000_000);
      userCgroup(root, "dam-user-light", i * 0.5 * 15_000_000);
      await fair.tick();
    }
    expect(weightOf(root, "dam-user-heavy")).toBeLessThanOrEqual(55);
    expect(weightOf(root, "dam-user-light")).toBe(DEFAULT_WEIGHT);
  });

  // TEST_SCENARIO: the same heavy use with nobody else on the node. Those cores were going spare, and charging someone for taking them would mean the first tick after a second person arrived found the first already at the floor — which hands the newcomer far more than a fair share.
  it("leaves a user alone on the node alone", async () => {
    const root = mkdtempSync(join(tmpdir(), "fs-"));
    let clock = 0;
    const fair = run(root, () => clock);
    userCgroup(root, "dam-user-heavy", 0);
    userCgroup(root, "dam-user-idle", 0);
    for (let i = 1; i <= 40; i++) {
      clock += 15_000;
      userCgroup(root, "dam-user-heavy", i * 4 * 15_000_000);
      userCgroup(root, "dam-user-idle", 0);
      await fair.tick();
    }
    expect(weightOf(root, "dam-user-heavy")).toBe(DEFAULT_WEIGHT);
  });

  // TEST_SCENARIO: a throttled user who stops. The penalty has to lift without anyone lifting it, or somebody who ran a build this morning is second-class for the rest of the day.
  it("lets the penalty decay once the user goes quiet", async () => {
    const root = mkdtempSync(join(tmpdir(), "fs-"));
    let clock = 0;
    const fair = run(root, () => clock);
    userCgroup(root, "dam-user-heavy", 0);
    userCgroup(root, "dam-user-light", 0);
    let heavy = 0;
    let light = 0;
    for (let i = 1; i <= 40; i++) {
      clock += 15_000;
      heavy += 4 * 15_000_000;
      light += 0.5 * 15_000_000;
      userCgroup(root, "dam-user-heavy", heavy);
      userCgroup(root, "dam-user-light", light);
      await fair.tick();
    }
    expect(weightOf(root, "dam-user-heavy")).toBeLessThan(DEFAULT_WEIGHT);

    for (let i = 1; i <= 80; i++) {
      clock += 15_000;
      light += 0.5 * 15_000_000;
      userCgroup(root, "dam-user-heavy", heavy);
      userCgroup(root, "dam-user-light", light);
      await fair.tick();
    }
    expect(weightOf(root, "dam-user-heavy")).toBe(DEFAULT_WEIGHT);
  });

  it("forgets a user whose cgroup has gone", async () => {
    const root = mkdtempSync(join(tmpdir(), "fs-"));
    const fair = createFairShare({
      capacityMilli: async () => 4000,
      root,
      log: () => {},
    });
    await fair.tick();
    userCgroup(root, "dam-user-a", 0);
    await expect(fair.tick()).resolves.toBeUndefined();
  });
});
