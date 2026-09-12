// TEST_OVERVIEW: the sweep is the node's only periodic reconciliation of every agent it holds, so anything in it that can throw decides whether the other agents get looked at. One leftover directory that would not delete — a mount still held, a file still open — aborted the whole pass and left every agent on the node unreconciled, which reads to a user as agents that simply never start. Found on a real node, where a single stale overlay starved a whole test suite.
import { chmodSync, mkdirSync, mkdtempSync } from "node:fs";
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

function supervisorOver(agentsRoot: string, directories: string[]) {
  const logged: string[] = [];
  const deps = {
    store: { listAssignedTo: async () => [], list: async () => [] },
    runsc: { list: async () => [] },
    network: { list: async () => [] },
    userCgroups: { prune: async () => {} },
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
