// TEST_OVERVIEW: reading what an agent is actually using. This is the number a user is shown when they ask which of their agents is heavy, and it is the only resource figure left in the product now that nobody chooses a size — so a CPU rate computed against the wrong interval, or a hibernated agent reported as using something, is a wrong answer with nothing beside it to correct it.
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createUsageReader } from "../../modules/sandboxes/infrastructure/cgroup-usage.js";

const root = mkdtempSync(join(tmpdir(), "cg-"));

function cgroup(
  agentId: string,
  memory: number,
  usageUsec: number,
  parent?: string,
) {
  const dir = join(root, ...(parent ? [parent] : []), `dam-${agentId}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "memory.current"), `${memory}\n`);
  writeFileSync(
    join(dir, "cpu.stat"),
    `usage_usec ${usageUsec}\nuser_usec 1\nsystem_usec 1\n`,
  );
}

describe("the share its owner is being given", () => {
  // TEST_SCENARIO: an agent whose owner has been tilted by the node's fair-use policy. The weight is read from the group the sandbox sits in rather than asked of the policy that wrote it, so what a user is shown is the figure the kernel is dividing by.
  it("reports the weight on the owner's group", async () => {
    mkdirSync(join(root, "dam-user-sub1"), { recursive: true });
    writeFileSync(join(root, "dam-user-sub1", "cpu.weight"), "57\n");
    cgroup("w", 1024, 0, "dam-user-sub1");
    const usage = await createUsageReader(root).read("w", "dam-user-sub1");
    expect(usage?.shareWeight).toBe(57);
  });

  it("reports no weight for an agent read without a group", async () => {
    cgroup("noparent", 1024, 0);
    expect((await createUsageReader(root).read("noparent"))?.shareWeight).toBe(
      null,
    );
  });
});

describe("what an agent is using", () => {
  it("reports memory from the first reading", async () => {
    cgroup("a", 512 * 1024 ** 2, 0);
    const reader = createUsageReader(root);
    expect(await reader.read("a")).toEqual({
      memoryBytes: 512 * 1024 ** 2,
      cpuMilli: null,
      shareWeight: null,
    });
  });

  // TEST_SCENARIO: a second reading far enough after the first to be a rate. Four seconds of CPU over two seconds of clock is two cores busy — 2000 millicores.
  it("reports CPU as a rate once it has two readings", async () => {
    let clock = 10_000;
    const reader = createUsageReader(root, () => clock);
    cgroup("b", 1024, 1_000_000);
    expect((await reader.read("b"))?.cpuMilli).toBeNull();
    clock += 2_000;
    cgroup("b", 1024, 1_000_000 + 4_000_000);
    expect((await reader.read("b"))?.cpuMilli).toBe(2000);
  });

  // TEST_SCENARIO: two readings taken too close together. A rate over a few milliseconds is noise dressed as a measurement, and a meter that flickers between 0 and 8 cores tells a user less than one that waits.
  it("waits for a gap worth dividing by", async () => {
    let clock = 50_000;
    const reader = createUsageReader(root, () => clock);
    cgroup("c", 1024, 0);
    await reader.read("c");
    clock += 50;
    cgroup("c", 1024, 40_000);
    expect((await reader.read("c"))?.cpuMilli).toBeNull();
  });

  it("says nothing at all about an agent that is not running", async () => {
    const reader = createUsageReader(root);
    expect(await reader.read("gone")).toBeNull();
  });
});
