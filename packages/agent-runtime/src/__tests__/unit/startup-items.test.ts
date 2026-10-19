// TEST_OVERVIEW: A vm agent's Startup Items reach the Processes panel. The scan reads PLATFORM_STARTUP beside the keep mark, and a reaper child whose tree carries it is one Startup Item row, keyed by the item, showing the item's own command, never keeping the agent awake. The panel's list joins the configured items with those rows, so a disabled or exited item is listed too, with its log as output. The list file the agent edits is read and written by the runtime for the user's Disable and Remove.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyProcesses } from "../../modules/processes/domain/classify.js";
import { assembleInventory } from "../../modules/processes/domain/inventory.js";
import { createKeepResolver } from "../../modules/processes/domain/keep.js";
import type { ScannedProcess } from "../../modules/processes/domain/snapshot.js";
import { startupItemsFrom } from "../../modules/processes/domain/startup-items.js";
import { createProcessTable } from "../../modules/processes/infrastructure/proc-scan.js";
import { createStartupItemStore } from "../../modules/processes/infrastructure/startup-items.js";

const RUNTIME = 8;
const LOOP = "/bin/sh /usr/local/lib/platform-startup/loop";

function proc(
  pid: number,
  ppid: number,
  cmdline: string,
  startupItem: string | null = null,
): ScannedProcess {
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
    startupItem,
  };
}

function inventory(extra: ScannedProcess[]) {
  const trees = classifyProcesses({
    snapshot: {
      scannedAt: 0,
      processes: [
        proc(1, 0, "/mnt/init"),
        proc(RUNTIME, 1, "node dist/server.js"),
        ...extra,
      ],
    },
    runtimePid: RUNTIME,
    harnesses: [],
    tasks: [],
  });
  const result = assembleInventory({
    trees,
    scannedAt: 0,
    baseline: null,
    previous: [],
    resolveKeep: createKeepResolver({ marks: [], overrides: [], holds: true }),
  });
  return { trees, ...result };
}

describe("Startup Item rows", () => {
  // TEST_SCENARIO: an item runs as a loop under the reaper, and the loop starts the item's command in a group of its own; both carry PLATFORM_STARTUP. The panel lists one row for the item, showing its command rather than the loop, and an item never keeps the agent awake, since it starts again at every wake.
  it("lists an item's loop as one Startup Item row showing its command", () => {
    const { trees, running, tracked } = inventory([
      proc(300, 1, LOOP, "web"),
      proc(301, 300, "sh -c python3 -m http.server 8799", "web"),
      proc(302, 301, "python3 -m http.server 8799", "web"),
      proc(400, 1, "sleep 100"),
    ]);

    const item = running.find((row) => row.pid === 300);
    expect(item).toMatchObject({
      kind: "startup-item",
      command: "sh -c python3 -m http.server 8799",
      keepsAwake: false,
      keepSource: "default",
    });
    expect(trees.find((t) => t.key === item?.key)?.startupItem).toBe("web");
    expect(running.find((row) => row.pid === 400)?.kind).toBe("detached");
    expect(running.filter((row) => row.kind === "startup-item")).toHaveLength(
      1,
    );
    expect(tracked.find((row) => row.kind === "startup-item")?.identity).toBe(
      "startup:web",
    );
  });

  // TEST_SCENARIO: the panel shows every configured item, so the user can enable a disabled one or read the log of one that exited; only a running item has a row to point at.
  it("lists configured items with or without a running row", () => {
    const { running, trees } = inventory([
      proc(300, 1, LOOP, "web"),
      proc(301, 300, "sh -c serve", "web"),
    ]);
    const items = startupItemsFrom(
      [
        { id: "web", command: "serve", disabled: false },
        { id: "setup", command: "make setup", disabled: false },
        { id: "off", command: "sleep infinity", disabled: true },
      ],
      running,
      (id) => `/home/agent/.platform/startup-logs/${id}.log`,
      (row) => trees.find((t) => t.key === row.key)?.startupItem ?? null,
    );

    expect(items).toEqual([
      {
        id: "web",
        command: "serve",
        disabled: false,
        running: true,
        rowKey: running.find((row) => row.pid === 300)!.key,
        outputPath: "/home/agent/.platform/startup-logs/web.log",
      },
      {
        id: "setup",
        command: "make setup",
        disabled: false,
        running: false,
        rowKey: null,
        outputPath: "/home/agent/.platform/startup-logs/setup.log",
      },
      {
        id: "off",
        command: "sleep infinity",
        disabled: true,
        running: false,
        rowKey: null,
        outputPath: "/home/agent/.platform/startup-logs/off.log",
      },
    ]);
  });
});

describe("the process scan", () => {
  // TEST_SCENARIO: the scan takes PLATFORM_STARTUP from a process's environment as it takes PLATFORM_KEEP, and nothing else, since the agent's credentials sit beside them.
  it("reads PLATFORM_STARTUP and drops every other variable", async () => {
    const proc = mkdtempSync(join(tmpdir(), "proc-"));
    writeFileSync(join(proc, "uptime"), "1000.00 900.00\n");
    const dir = join(proc, "42");
    mkdirSync(join(dir, "fd"), { recursive: true });
    writeFileSync(
      join(dir, "stat"),
      "42 (sh) S 1 42 42 0 -1 0 0 0 0 0 5 5 0 0 20 0 1 0 100 0 0",
    );
    writeFileSync(join(dir, "status"), "VmRSS:\t1024 kB\n");
    writeFileSync(join(dir, "cmdline"), "sh\0-c\0serve\0");
    writeFileSync(
      join(dir, "environ"),
      "GH_TOKEN=platform:conn:abc\0PLATFORM_STARTUP=web\0PATH=/bin\0",
    );

    const { processes } = await createProcessTable(proc).scan();

    expect(processes).toHaveLength(1);
    expect(processes[0]).toMatchObject({
      startupItem: "web",
      keepMark: null,
    });
    expect(JSON.stringify(processes[0])).not.toContain("platform:conn");
  });
});

describe("the Startup Items list", () => {
  function home(list: unknown) {
    const dir = mkdtempSync(join(tmpdir(), "home-"));
    mkdirSync(join(dir, ".platform"));
    writeFileSync(
      join(dir, ".platform", "startup.json"),
      typeof list === "string" ? list : JSON.stringify(list),
    );
    return dir;
  }

  // TEST_SCENARIO: the user's Disable is written into the list the agent edits, and Remove takes the item out of it, so the image's boot and `platform-startup` both see the user's decision.
  it("reads items and writes the user's Disable and Remove into the list", () => {
    const dir = home({
      items: [
        { id: "web", command: "serve" },
        { id: "setup", command: "make setup" },
      ],
    });
    const store = createStartupItemStore(dir);

    expect(store.list()).toEqual([
      { id: "web", command: "serve", disabled: false },
      { id: "setup", command: "make setup", disabled: false },
    ]);
    expect(store.setDisabled("web", true)).toBe(true);
    expect(store.remove("setup")).toBe(true);
    expect(store.setDisabled("nope", true)).toBe(false);

    const written = JSON.parse(
      readFileSync(join(dir, ".platform", "startup.json"), "utf8"),
    );
    expect(written).toEqual({
      items: [{ id: "web", command: "serve", disabled: true }],
    });
    expect(store.logPath("web")).toBe(
      join(dir, ".platform", "startup-logs", "web.log"),
    );
  });

  // TEST_SCENARIO: a list that does not parse starts nothing at boot, so the panel lists nothing rather than failing.
  it("reads a list that does not parse as empty", () => {
    expect(createStartupItemStore(home("{not json")).list()).toEqual([]);
    expect(createStartupItemStore(home({ items: "x" })).list()).toEqual([]);
  });
});
