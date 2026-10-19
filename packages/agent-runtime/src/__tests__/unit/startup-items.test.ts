// TEST_OVERVIEW: A vm agent's Startup Items reach the Processes panel, and the user controls them there. The scan reads PLATFORM_STARTUP beside the keep mark, and a reaper child whose tree carries it is one Startup Item row, keyed by the item, showing the item's own command, never keeping the agent awake. The panel's list joins the configured items with those rows, so a disabled or exited item is listed too, with its log as output. The list file the agent edits is read and written by the runtime for the user's Disable and Remove, and each of the user's actions goes through the image's control, refusing an item that is off or unknown.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFileDocumentStoreBackend } from "../../core/document-store.js";
import { classifyProcesses } from "../../modules/processes/domain/classify.js";
import { assembleInventory } from "../../modules/processes/domain/inventory.js";
import { createKeepResolver } from "../../modules/processes/domain/keep.js";
import type { ScannedProcess } from "../../modules/processes/domain/snapshot.js";
import {
  startupItemsFrom,
  type StartupItemConfig,
} from "../../modules/processes/domain/startup-items.js";
import { createProcessTable } from "../../modules/processes/infrastructure/proc-scan.js";
import { openProcessesDocument } from "../../modules/processes/infrastructure/processes-document.js";
import {
  createStartupItemStore,
  type StartupItemStore,
} from "../../modules/processes/infrastructure/startup-items.js";
import { createProcessesService } from "../../modules/processes/services/processes-service.js";

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
    expect(
      tracked.map((row) => row.kind),
      "an item keeps no finished history; its log is its history",
    ).toEqual(["detached"]);
  });

  // TEST_SCENARIO: the panel shows every configured item, so the user can turn a disabled one back on or read the log of one that exited; an item runs when the scan found its row.
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
        outputPath: "/home/agent/.platform/startup-logs/web.log",
      },
      {
        id: "setup",
        command: "make setup",
        disabled: false,
        running: false,
        outputPath: "/home/agent/.platform/startup-logs/setup.log",
      },
      {
        id: "off",
        command: "sleep infinity",
        disabled: true,
        running: false,
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

describe("the user's control of Startup Items", () => {
  function service(items: StartupItemConfig[]) {
    const runs: string[] = [];
    const disabled = new Map(items.map((i) => [i.id, i.disabled]));
    let list = items;
    const startupItems: StartupItemStore = {
      available: () => true,
      list: () => list.map((i) => ({ ...i, disabled: disabled.get(i.id)! })),
      setDisabled: (id, value) => {
        disabled.set(id, value);
        return true;
      },
      remove: (id) => {
        list = list.filter((i) => i.id !== id);
        return true;
      },
      logPath: (id) => `/logs/${id}.log`,
      run: async (action, id) => {
        runs.push(`${action} ${id}`);
        return action === "start" && id === "broken" ? "ctl failed" : null;
      },
    };
    const document = createFileDocumentStoreBackend(
      mkdtempSync(join(tmpdir(), "state-")),
    );
    const processes = createProcessesService({
      table: {
        scan: async () => ({ scannedAt: Date.now(), processes: [] }),
        bootId: async () => "boot",
      },
      document: openProcessesDocument(document),
      outputs: { tail: async (path) => ({ text: path, truncated: false }) },
      signals: { send: () => true },
      keep: { setKeptProcesses: () => {}, taskKeepChanged: () => {} } as never,
      backgroundWorkHolds: true,
      runtimePid: RUNTIME,
      harnessWork: {
        harnesses: () => [],
        reportedTasks: () => [],
        forgetTask: () => {},
        pendingRestart: () => null,
        applyPendingRestart: () => false,
        onChange: () => {},
      },
      startupItems,
      log: () => {},
    });
    return { processes, runs, disabled };
  }

  // TEST_SCENARIO: turning an item off writes the user's choice before the item stops, so the next boot skips it; turning it on starts it at once.
  it("writes the user's choice and stops or starts the item", async () => {
    const { processes, runs, disabled } = service([
      { id: "web", command: "serve", disabled: false },
    ]);

    expect((await processes.setStartupItemEnabled("web", false)).ok).toBe(true);
    expect(disabled.get("web")).toBe(true);
    expect((await processes.setStartupItemEnabled("web", true)).ok).toBe(true);
    expect(disabled.get("web")).toBe(false);
    expect(runs).toEqual(["stop web", "start web"]);
  });

  // TEST_SCENARIO: an item the user turned off does not start from the panel's Restart either, until the user turns it on; an unknown item is not found.
  it("refuses to restart an item that is off, and an unknown item", async () => {
    const { processes, runs } = service([
      { id: "off", command: "sleep infinity", disabled: true },
    ]);

    const restart = await processes.restartStartupItem("off");
    expect(restart.ok).toBe(false);
    expect(restart.ok ? null : restart.error.kind).toBe("NotAllowed");
    const unknown = await processes.stopStartupItem("nope");
    expect(unknown.ok ? null : unknown.error.kind).toBe("NotFound");
    expect(runs).toEqual([]);
  });

  // TEST_SCENARIO: Remove stops the item and takes it out of the list, and a control that fails says why rather than reporting success.
  it("removes an item, and reports a control that failed", async () => {
    const { processes, runs } = service([
      { id: "web", command: "serve", disabled: false },
      { id: "broken", command: "false", disabled: true },
    ]);

    expect((await processes.removeStartupItem("web")).ok).toBe(true);
    expect((await processes.list()).startupItems.map((i) => i.id)).toEqual([
      "broken",
    ]);
    const failed = await processes.setStartupItemEnabled("broken", true);
    expect(failed.ok ? null : failed.error).toEqual({
      kind: "NotAllowed",
      message: "ctl failed",
    });
    expect(runs).toEqual(["stop web", "start broken"]);
  });

  // TEST_SCENARIO: an item without a running row still opens its log, by a key made from its id.
  it("opens an item's log by its id", async () => {
    const { processes } = service([
      { id: "web", command: "serve", disabled: false },
    ]);

    const output = await processes.output("startup:web");
    expect(output.ok ? output.value.text : null).toBe("/logs/web.log");
    expect((await processes.output("startup:nope")).ok).toBe(false);
  });
});
