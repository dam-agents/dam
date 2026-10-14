// TEST_OVERVIEW: Detached Processes that are containers or container runtime daemons carry what they are, read from the command line alone: a containerd shim names its namespace and container id, so a Docker or k3s container row says which engine runs it and its short id, and dockerd, containerd and the k3s server say they are a runtime. Every other row carries nothing. The mark stays on the row when it moves to the finished history, and a processes document written before rows had it still loads.
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { createFileDocumentStoreBackend } from "../../core/document-store.js";
import { classifyProcesses } from "../../modules/processes/domain/classify.js";
import {
  assembleInventory,
  type TrackedRow,
} from "../../modules/processes/domain/inventory.js";
import { openProcessesDocument } from "../../modules/processes/infrastructure/processes-document.js";
import type { ScannedProcess } from "../../modules/processes/domain/snapshot.js";

const RUNTIME = 8;
const DOCKER_ID =
  "3f2a9c1b4e5d6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8";
const POD_ID =
  "9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b7a6f5e4d3c2b1a0f9e8d";

function proc(pid: number, ppid: number, cmdline: string): ScannedProcess {
  return {
    pid,
    ppid,
    pgrp: pid,
    sid: pid,
    startTicks: pid,
    startedAtMs: pid,
    cpuTicks: 0,
    rssBytes: 0,
    cmdline,
    outputPath: null,
    keepMark: null,
  };
}

function scan(extra: ScannedProcess[], previous: TrackedRow[] = []) {
  const trees = classifyProcesses({
    snapshot: {
      scannedAt: 0,
      processes: [
        proc(1, 0, "catatonit"),
        proc(RUNTIME, 1, "node dist/server.js"),
        ...extra,
      ],
    },
    runtimePid: RUNTIME,
    harnesses: [],
    tasks: [],
  });
  return assembleInventory({
    trees,
    scannedAt: 0,
    baseline: null,
    previous,
    resolveKeep: () => ({ keepsAwake: false, keepSource: "default" }),
  });
}

function containersOf(extra: ScannedProcess[]) {
  const { running } = scan(extra);
  return new Map(running.map((row) => [row.pid, row.container]));
}

const dockerShim = proc(
  200,
  1,
  `/usr/bin/containerd-shim-runc-v2 -namespace moby -id ${DOCKER_ID} -address /run/containerd/containerd.sock`,
);

describe("container rows", () => {
  // TEST_SCENARIO: the shims Docker and k3s start re-parent to the reaper, one Detached Process each; the row names the engine by the shim's namespace or its k3s paths, and the id cut to 12 characters.
  it("names a Docker or k3s container by its engine and short id", () => {
    const containers = containersOf([
      dockerShim,
      proc(201, 200, "nginx: master process nginx -g daemon off;"),
      proc(
        300,
        1,
        `/var/lib/rancher/k3s/data/abc/bin/containerd-shim-runc-v2 -namespace k8s.io -id ${POD_ID} -address /run/k3s/containerd/containerd.sock`,
      ),
      proc(301, 300, "/pause"),
    ]);

    expect(containers.get(200)).toEqual({
      role: "container",
      engine: "docker",
      id: "3f2a9c1b4e5d",
    });
    expect(containers.get(300)).toEqual({
      role: "container",
      engine: "k3s",
      id: "9e8d7c6b5a4f",
    });
  });

  // TEST_SCENARIO: the daemons are started detached by the agent, often through a shell wrapper; each is marked a runtime of its engine.
  it("marks dockerd, containerd and the k3s server as runtimes", () => {
    const containers = containersOf([
      proc(400, 1, "dockerd"),
      proc(
        401,
        400,
        "containerd --config /var/run/docker/containerd/containerd.toml",
      ),
      proc(500, 1, "/usr/local/bin/k3s server"),
      proc(
        501,
        500,
        "containerd -c /var/lib/rancher/k3s/agent/etc/containerd/config.toml",
      ),
      proc(600, 1, "bash -c eval 'containerd --log-level info'"),
      proc(601, 600, "containerd --log-level info"),
    ]);

    expect(containers.get(400)).toEqual({ role: "runtime", engine: "docker" });
    expect(containers.get(500)).toEqual({ role: "runtime", engine: "k3s" });
    expect(containers.get(600)).toEqual({
      role: "runtime",
      engine: "containerd",
    });
  });

  // TEST_SCENARIO: a command that only mentions a runtime is not one, so ordinary work stays an ordinary Detached Process.
  it("leaves every other command unmarked", () => {
    const containers = containersOf([
      proc(700, 1, "sleep 600"),
      proc(800, 1, "docker logs -f web"),
      proc(900, 1, "k3s kubectl get pods -w"),
      proc(1000, 1, "containerd-shim-runc-v2 -namespace moby"),
    ]);

    expect(containers.get(700)).toBeNull();
    expect(containers.get(800)).toBeNull();
    expect(containers.get(900)).toBeNull();
    expect(containers.get(1000)).toBeNull();
  });
});

describe("finished container rows", () => {
  // TEST_SCENARIO: a container whose shim is gone from the next scan moves to the finished history; the finished row keeps the engine and short id, so the panel shows it the way it showed the running row.
  it("keeps the container mark when the row finishes", () => {
    const { tracked } = scan([dockerShim]);
    const { finished } = scan([], tracked);

    expect(finished).toHaveLength(1);
    expect(finished[0]?.container).toEqual({
      role: "container",
      engine: "docker",
      id: "3f2a9c1b4e5d",
    });
  });

  // TEST_SCENARIO: an agent home keeps the processes document across an upgrade; rows written before they had a container mark read as unmarked, instead of failing the parse and losing the finished history.
  it("loads a document written before rows had a container mark", () => {
    const home = mkdtempSync(join(tmpdir(), "processes-document-"));
    mkdirSync(join(home, ".platform"));
    const row = {
      key: "200:200",
      kind: "detached",
      command: "sleep 600",
      startedAt: "2026-10-13T10:00:00.000Z",
      outputPath: null,
      keepSource: "default",
    };
    writeFileSync(
      join(home, ".platform", "processes.json"),
      JSON.stringify({
        bootId: "boot-1",
        lastScanAt: null,
        lastRunning: [
          {
            ...row,
            identity: "200:200",
            procKey: "200:200",
            keepsAwake: false,
          },
        ],
        finished: [
          {
            ...row,
            finishedAt: "2026-10-13T11:00:00.000Z",
            endedBy: "exit",
            keptAwake: false,
          },
        ],
      }),
    );

    const doc = openProcessesDocument(
      createFileDocumentStoreBackend(home),
    ).read();

    expect(doc.bootId).toBe("boot-1");
    expect(doc.lastRunning[0]?.container).toBeNull();
    expect(doc.finished[0]?.container).toBeNull();
  });
});
