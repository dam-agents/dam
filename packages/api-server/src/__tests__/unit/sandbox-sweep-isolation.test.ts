// TEST_OVERVIEW: the sweep is the node's only periodic reconciliation of every agent it holds, so anything in it that can throw decides whether the other agents get looked at. One leftover directory that would not delete — a mount still held, a file still open — aborted the whole pass and left every agent on the node unreconciled, which reads to a user as agents that simply never start. Found on a real node, where a single stale overlay starved a whole test suite.
import { chmodSync, existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSandboxSupervisor,
  type SandboxSupervisorDeps,
} from "../../modules/sandboxes/services/sandbox-supervisor.js";

const roots: string[] = [];
afterEach(() => {
  for (const r of roots) chmodSync(r, 0o700);
  roots.length = 0;
});

function supervisorOver(
  agentsRoot: string,
  directories: string[],
  records: { id: string }[] = [{ id: "agent-elsewhere" }],
) {
  const logged: string[] = [];
  const deps = {
    store: { listAssignedTo: async () => [], list: async () => records },
    runsc: { list: async () => [] },
    network: { list: async () => [] },
    userCgroups: { prune: async () => {} },
    images: { prune: async () => {} },
    imageRetentionMs: 7 * 86_400_000,
    directories: async () => directories,
    agentsRoot,
    nodeId: "node-1",
    log: (message: string) => logged.push(message),
  };
  return {
    supervisor: createSandboxSupervisor(
      deps as unknown as SandboxSupervisorDeps,
    ),
    logged,
  };
}

describe("a stale workspace that will not delete", () => {
  // TEST_SCENARIO: a directory inside a parent nothing may write, which cannot be removed — the shape a still-held mount takes to whoever is trying to delete it.
  it("does not stop the sweep from reaching the next agent", async () => {
    const root = mkdtempSync(join(tmpdir(), "sweep-"));
    roots.push(root);
    mkdirSync(join(root, "agent-stuck"));
    mkdirSync(join(root, "agent-next"));
    chmodSync(root, 0o500);

    const { supervisor, logged } = supervisorOver(root, [
      "agent-stuck",
      "agent-next",
    ]);
    await expect(supervisor.sweep()).resolves.toBeUndefined();
    expect(
      logged.filter((m) => m === "sandbox.sweep.stale-workspace"),
    ).toHaveLength(2);
    expect(logged).toContain("sandbox.sweep.stale-workspace.failed");
  });

  it("says which agent it could not reclaim", async () => {
    const root = mkdtempSync(join(tmpdir(), "sweep-"));
    roots.push(root);
    mkdirSync(join(root, "agent-stuck"));
    chmodSync(root, 0o500);
    const { supervisor, logged } = supervisorOver(root, ["agent-stuck"]);
    await supervisor.sweep();
    expect(logged).toContain("sandbox.sweep.stale-workspace.failed");
  });
});

// TEST_OVERVIEW: the reaper deletes every directory no record claims, which is right whenever the records are the truth and catastrophic in the one state where they are not yet: a database not reached, or one a migration is still filling. Measured on the rehearsal install, the equivalent sweep over agent-scoped rows reaped an agent's whole configuration in that window. This one reaps the work itself.
describe("the reaper against a record table that is empty", () => {
  // TEST_SCENARIO: directories on disk and no agents at all anywhere in the install — an importer that has not run yet, or a read that came back empty. Deleting here is unrecoverable, so it does not.
  it("refuses rather than treating every agent as stale", async () => {
    const root = mkdtempSync(join(tmpdir(), "sweep-"));
    roots.push(root);
    mkdirSync(join(root, "agent-a"));

    const { supervisor, logged } = supervisorOver(root, ["agent-a"], []);
    await supervisor.sweep();

    expect(logged).toContain("sandbox.sweep.stale-workspace.refused");
    expect(logged).not.toContain("sandbox.sweep.stale-workspace");
    expect(existsSync(join(root, "agent-a"))).toBe(true);
  });

  // TEST_SCENARIO: an install that really has no agents and no directories either. There is nothing to protect, so the refusal must not fire and hide a later real sweep.
  it("does not refuse when there is nothing on disk either", async () => {
    const root = mkdtempSync(join(tmpdir(), "sweep-"));
    roots.push(root);
    const { supervisor, logged } = supervisorOver(root, [], []);
    await supervisor.sweep();
    expect(logged).not.toContain("sandbox.sweep.stale-workspace.refused");
  });
});
