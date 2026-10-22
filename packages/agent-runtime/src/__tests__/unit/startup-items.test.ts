// TEST_OVERVIEW: A vm agent's Startup Items — its own openrc services, run as root from ~/.config/rc — reach the Processes panel, and the user controls them there; an open Environment Link, seen in the same scan, keeps the agent busy. The scan takes the service name a supervise-daemon carries (RC_USER_SERVICES, RC_SVCNAME) beside the keep mark, and the supervisor's tree is one Startup Item row, keyed by the service, showing the service's own command, never keeping the agent awake. openrc's own `user.root` supervisor, which runs openrc-user over those services, is no row at all: its processes go, its services are re-parented to the reaper in its place, and a history record of it is left out. The panel's list joins the services on disk with those rows, so a disabled or exited service is listed too, with its log as output. The user's Disable removes the boot link and Remove deletes the script; Start, Stop and Restart go through rc-service, refusing a service that is off or unknown.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { FinishedRow } from "agent-runtime-api";
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
import { createStartupItemEnvFile } from "../../modules/processes/infrastructure/startup-item-env.js";
import { createStartupItemEnv } from "../../modules/processes/services/startup-item-env.js";
import {
  createStartupItemStore,
  type StartupItemStore,
} from "../../modules/processes/infrastructure/startup-items.js";
import { createProcessesService } from "../../modules/processes/services/processes-service.js";

const RUNTIME = 8;
const USER_SERVICES_MANAGER =
  "supervise-daemon user.root --start --retry TERM/60 --respawn-max 3 --respawn-period 5 --notify fd:3 /usr/lib/rc/bin/openrc-user -- root";
const SUPERVISOR = (name: string) =>
  `supervise-daemon ${name} --start --chdir /home/agent/work /bin/sh -- -c serve`;

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
    link: null,
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
    resolveKeep: createKeepResolver({ marks: [], overrides: [] }),
  });
  return { trees, ...result };
}

describe("Startup Item rows", () => {
  // TEST_SCENARIO: openrc's supervise-daemon runs one of the agent's services under the reaper, and the service's command below it; the supervisor carries the service's name. The panel lists one row for the service, showing its command rather than the supervisor, and a service never keeps the agent awake, since it starts again at every wake.
  it("lists a service's supervisor as one Startup Item row showing its command", () => {
    const { trees, running, tracked } = inventory([
      proc(300, 1, SUPERVISOR("web"), "web"),
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

  // TEST_SCENARIO: a service name that fails the name rule makes no Startup Item, which no Login item would list, and neither does a process that only inherited a service's variables below another root; such a tree stays a Detached Process, so nothing that runs is hidden.
  it("leaves a tree with a malformed name, or a name below its root, a Detached Process", () => {
    const { running } = inventory([
      proc(300, 1, "sh -c serve", "../escape"),
      proc(301, 300, "serve", "../escape"),
      proc(400, 1, "sh -c other"),
      proc(401, 400, "child", "web"),
    ]);

    expect(running.find((row) => row.pid === 300)?.kind).toBe("detached");
    expect(running.find((row) => row.pid === 400)?.kind).toBe("detached");
  });

  // TEST_SCENARIO: the panel shows every configured item, so the user can turn a disabled one back on or read the log of one that exited; an item runs when the scan found its row.
  it("lists configured items with or without a running row", () => {
    const { running, trees } = inventory([
      proc(300, 1, SUPERVISOR("web"), "web"),
      proc(301, 300, "sh -c serve", "web"),
    ]);
    const items = startupItemsFrom(
      [
        { id: "web", command: "serve", disabled: false },
        { id: "setup", command: "make setup", disabled: false },
        { id: "off", command: "sleep infinity", disabled: true },
      ],
      running,
      (id) => `/home/agent/.local/state/rc/${id}.log`,
      (row) => trees.find((t) => t.key === row.key)?.startupItem ?? null,
    );

    expect(items).toEqual([
      {
        id: "web",
        command: "serve",
        disabled: false,
        running: true,
        listed: true,
        outputPath: "/home/agent/.local/state/rc/web.log",
      },
      {
        id: "setup",
        command: "make setup",
        disabled: false,
        running: false,
        listed: true,
        outputPath: "/home/agent/.local/state/rc/setup.log",
      },
      {
        id: "off",
        command: "sleep infinity",
        disabled: true,
        running: false,
        listed: true,
        outputPath: "/home/agent/.local/state/rc/off.log",
      },
    ]);
  });
});

describe("openrc's user-services manager", () => {
  // TEST_SCENARIO: openrc's `user.root` service supervises openrc-user, which starts the agent's own services. The manager is no row at all — not in the list, the badge or the history — and the docker service it started is one Startup Item row, as it would be without the manager; a Detached Process beside it still lists.
  it("drops the manager and lists its services as their own rows", () => {
    const { trees, running, tracked, finished } = inventory([
      proc(200, 1, USER_SERVICES_MANAGER),
      proc(201, 200, "/usr/lib/rc/bin/openrc-user -- root"),
      proc(300, 201, SUPERVISOR("docker"), "docker"),
      proc(301, 300, "dockerd", "docker"),
      proc(400, 1, "sleep 100"),
    ]);

    expect(running.map((row) => [row.pid, row.kind, row.command])).toEqual([
      [300, "startup-item", "dockerd"],
      [400, "detached", "sleep 100"],
    ]);
    expect(
      trees.find((t) => t.key === "300:300")?.members.map((m) => m.pid),
    ).toEqual([300, 301]);
    expect(tracked.map((row) => row.command)).toEqual(["sleep 100"]);
    expect(finished).toEqual([]);
  });

  // TEST_SCENARIO: a history written before the manager was dropped kept a record of it; the list leaves it out, so the panel never shows work it no longer lists.
  it("leaves a manager record the history kept out of the list", async () => {
    const backend = createFileDocumentStoreBackend(
      mkdtempSync(join(tmpdir(), "state-")),
    );
    const document = openProcessesDocument(backend);
    const finished: FinishedRow = {
      key: "200:200",
      kind: "detached",
      command: USER_SERVICES_MANAGER,
      startedAt: "2024-01-01T00:00:00.000Z",
      finishedAt: "2024-01-01T00:00:01.000Z",
      endedBy: "exit",
      outputPath: null,
      keptAwake: false,
      keepSource: "default",
      container: null,
    };
    document.write({
      bootId: "boot",
      lastScanAt: null,
      lastRunning: [],
      finished: [
        finished,
        { ...finished, key: "400:400", command: "sleep 100" },
      ],
      marks: [],
      overrides: [],
    });
    const processes = createProcessesService({
      table: {
        scan: async () => ({ scannedAt: Date.now(), processes: [] }),
        bootId: async () => "boot",
      },
      document,
      outputs: { tail: async () => null },
      signals: { send: () => true },
      keep: {
        setKeptProcesses: () => {},
        setOpenLinks: () => {},
        taskKeepChanged: () => {},
      } as never,
      runtimePid: RUNTIME,
      harnessWork: {
        harnesses: () => [],
        reportedTasks: () => [],
        forgetTask: () => {},
        pendingRestart: () => null,
        applyPendingRestart: () => false,
        onChange: () => {},
      },
      startupItems: { available: () => false } as never,
      log: () => {},
    });

    expect((await processes.list()).finished.map((row) => row.command)).toEqual(
      ["sleep 100"],
    );
  });
});

describe("a service no script names", () => {
  // TEST_SCENARIO: a service keeps running after its script left ~/.config/rc — removed while it ran — and the panel lists it, as not listed, with the command it runs, so nothing that runs is hidden.
  it("lists a running item that no entry names", () => {
    const { running, trees } = inventory([
      proc(300, 1, SUPERVISOR("gone"), "gone"),
      proc(301, 300, "sh -c serve", "gone"),
    ]);
    const items = startupItemsFrom(
      [],
      running,
      (id) => `/logs/${id}.log`,
      (row) => trees.find((t) => t.key === row.key)?.startupItem ?? null,
    );

    expect(items).toEqual([
      {
        id: "gone",
        command: "sh -c serve",
        disabled: false,
        running: true,
        listed: false,
        outputPath: "/logs/gone.log",
      },
    ]);
  });
});

describe("the process scan", () => {
  // TEST_SCENARIO: the scan takes the service name a user-mode openrc supervisor carries, and PLATFORM_LINK, as it takes PLATFORM_KEEP, and nothing else, since the agent's credentials sit beside them; a system service's name is no Startup Item.
  it("reads a user service's name and PLATFORM_LINK and drops every other variable", async () => {
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
      "GH_TOKEN=platform:conn:abc\0RC_USER_SERVICES=yes\0RC_SVCNAME=web\0PLATFORM_LINK=env-a\0PATH=/bin\0",
    );

    const { processes } = await createProcessTable(proc).scan();

    expect(processes).toHaveLength(1);
    expect(processes[0]).toMatchObject({
      startupItem: "web",
      keepMark: null,
      link: "env-a",
    });
    expect(JSON.stringify(processes[0])).not.toContain("platform:conn");
  });
});

describe("an open Environment Link", () => {
  // TEST_SCENARIO: an open Environment Link is a tree of processes that inherit PLATFORM_LINK — the agent's SSH proxy, its shell, subshells and socat — and the scan publishes one link for the tree, which makes the runtime busy whatever the keep decisions say, so neither machine hibernates during a long image import.
  it("publishes one open link per marked tree", async () => {
    const links: number[] = [];
    let scanned: ScannedProcess[] = [
      { ...proc(500, 1, "ssh env-pr-42"), link: null },
      {
        ...proc(501, 500, "python3 platform-env proxy env-pr-42"),
        link: "env-pr-42",
      },
      { ...proc(502, 501, "sh -c socat …"), link: "env-pr-42" },
      { ...proc(503, 502, "sh -c socat …"), link: "env-pr-42" },
      { ...proc(504, 503, "socat - VSOCK-CONNECT:2:6100"), link: "env-pr-42" },
    ];
    let now = 0;
    const processes = createProcessesService({
      table: {
        scan: async () => ({ scannedAt: now, processes: scanned }),
        bootId: async () => "boot",
      },
      document: openProcessesDocument(
        createFileDocumentStoreBackend(mkdtempSync(join(tmpdir(), "state-"))),
      ),
      outputs: { tail: async (path) => ({ text: path, truncated: false }) },
      signals: { send: () => true },
      keep: {
        setKeptProcesses: () => {},
        setOpenLinks: (count: number) => links.push(count),
        taskKeepChanged: () => {},
      } as never,
      runtimePid: RUNTIME,
      harnessWork: {
        harnesses: () => [],
        reportedTasks: () => [],
        forgetTask: () => {},
        pendingRestart: () => null,
        applyPendingRestart: () => false,
        onChange: () => {},
      },
      startupItems: { available: () => false } as never,
      log: () => {},
    });

    vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      await processes.list();
      expect(links.at(-1)).toBe(1);
      scanned = [];
      now += 60_000;
      await processes.list();
      expect(links.at(-1)).toBe(0);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("the agent's services on disk", () => {
  function home(services: Record<string, string>, atBoot: string[]) {
    const dir = mkdtempSync(join(tmpdir(), "home-"));
    const initDir = join(dir, ".config", "rc", "init.d");
    const bootDir = join(dir, ".config", "rc", "runlevels", "default");
    mkdirSync(initDir, { recursive: true });
    mkdirSync(bootDir, { recursive: true });
    for (const [name, body] of Object.entries(services))
      writeFileSync(join(initDir, name), body);
    for (const name of atBoot)
      symlinkSync(join(initDir, name), join(bootDir, name));
    return { dir, initDir, bootDir };
  }

  const script = (command: string, args = "") =>
    `#!/sbin/openrc-run\ncommand=${command}\n${args ? `command_args="${args}"\n` : ""}`;

  // TEST_SCENARIO: each script in ~/.config/rc/init.d is a service, showing its command and arguments, on at boot when the default runlevel links it. The user's Disable removes that link and turning it on makes it again; Remove deletes the script and its link, so the boot and the agent see the user's choice.
  it("lists services and writes the user's Disable and Remove as openrc keeps them", async () => {
    const { dir, initDir, bootDir } = home(
      {
        web: script("/usr/bin/python3", "-m http.server 8799"),
        setup: script("/usr/bin/make", "setup"),
      },
      ["web"],
    );
    const store = createStartupItemStore(dir);

    expect(store.list()).toEqual([
      { id: "setup", command: "/usr/bin/make setup", disabled: true },
      {
        id: "web",
        command: "/usr/bin/python3 -m http.server 8799",
        disabled: false,
      },
    ]);
    expect(await store.setDisabled("web", true)).toBe(true);
    expect(existsSync(join(bootDir, "web"))).toBe(false);
    expect(await store.setDisabled("setup", false)).toBe(true);
    expect(readlinkSync(join(bootDir, "setup"))).toBe(join(initDir, "setup"));
    expect(await store.remove("setup")).toBe(true);
    expect(existsSync(join(initDir, "setup"))).toBe(false);
    expect(existsSync(join(bootDir, "setup"))).toBe(false);
    expect(await store.setDisabled("nope", true)).toBe(false);
    expect(store.logPath("web")).toBe(
      join(dir, ".local", "state", "rc", "web.log"),
    );
  });

  // TEST_SCENARIO: a file whose name fails the name rule is not a service, so a path never names a log outside the log directory; an agent with no ~/.config/rc lists nothing.
  it("lists no file of another shape, and nothing without the directory", () => {
    const { dir } = home({ web: script("serve"), ".hidden": script("x") }, []);
    const store = createStartupItemStore(dir);

    expect(store.list().map((i) => i.id)).toEqual(["web"]);
    expect(() => store.logPath("../escape")).toThrow();
    expect(
      createStartupItemStore(mkdtempSync(join(tmpdir(), "empty-"))).list(),
    ).toEqual([]);
  });
});

describe("the env a Startup Item starts with", () => {
  // TEST_SCENARIO: openrc adds every variable of ~/.config/rc/profile.env that its filter left unset to a user service, so the runtime writes its own env there, connection placeholders included, and a GitHub item can use gh. A value openrc's parser would cut at a quote or `#`, or keep whole when it starts with `$`, and a name no shell takes, are left out rather than delivered wrong, and so is the runtime's own PORT, which a service's server would take; the file is root's alone and replaced whole, so a new env drops a variable that went away. A write says whether the file changed, which decides whether items restart.
  it("writes the runtime's env as openrc reads it, leaving out what its parser would change", () => {
    const dir = mkdtempSync(join(tmpdir(), "home-"));
    const file = createStartupItemEnvFile(dir);
    const path = join(dir, ".config", "rc", "profile.env");
    const env = {
      PLATFORM_GH_TOKEN_AVAILABLE: "true",
      GH_TOKEN: "platform:conn:abc",
      ANTHROPIC_BASE_URL: "http://127.0.0.1:9/v1?a=b c",
      QUOTED: 'say "hi"',
      SINGLE: "it's",
      HASH: "a#b",
      DOLLAR: "$HOME",
      MULTI: "a\nb",
      "BAD-NAME": "x",
      UNSET: undefined,
      PORT: "8080",
      PWD: "/app",
    };

    expect(file.write(env)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(
      [
        "ANTHROPIC_BASE_URL=http://127.0.0.1:9/v1?a=b c",
        "GH_TOKEN=platform:conn:abc",
        "PLATFORM_GH_TOKEN_AVAILABLE=true",
        "",
      ].join("\n"),
    );
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(file.write({ ...env, PORT: "9090", QUOTED: "x'y" })).toBe(false);

    expect(file.write({ PLATFORM_GH_TOKEN_AVAILABLE: "false" })).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(
      "PLATFORM_GH_TOKEN_AVAILABLE=false\n",
    );
    expect(readdirSync(join(dir, ".config", "rc"))).toEqual(["profile.env"]);
  });
});

describe("a new env reaches the running Startup Items", () => {
  function harness(opts: {
    available?: boolean;
    running?: string[];
    failing?: string[];
  }) {
    const dir = mkdtempSync(join(tmpdir(), "home-"));
    const restarted: string[] = [];
    const logs: string[] = [];
    const env = createStartupItemEnv({
      file: createStartupItemEnvFile(dir),
      available: () => opts.available ?? true,
      running: async () => opts.running ?? [],
      restart: async (id) => {
        restarted.push(id);
        return opts.failing?.includes(id) ? "rc-service: failed" : null;
      },
      log: (msg) => logs.push(msg),
    });
    return { dir, env, restarted, logs };
  }

  // TEST_SCENARIO: a process keeps the env it started with, so a connection added or removed reaches a running item only when it starts again. A changed env restarts every running item through openrc, as the pod service is respawned; the same env, pushed again, restarts nothing. At boot, items start before the runtime from the file of the last run, so the first push restarts them only when the env moved meanwhile.
  it("restarts the running items when the env changed, and only then", async () => {
    const { dir, env, restarted, logs } = harness({ running: ["web", "sync"] });

    await env.apply({ GH_TOKEN: "platform:conn:a" });
    expect(restarted).toEqual(["web", "sync"]);
    await env.apply({ GH_TOKEN: "platform:conn:a", PORT: "8080" });
    expect(restarted).toEqual(["web", "sync"]);
    await env.apply({ GH_TOKEN: "platform:conn:b" });
    expect(restarted).toEqual(["web", "sync", "web", "sync"]);
    expect(
      readFileSync(join(dir, ".config", "rc", "profile.env"), "utf8"),
    ).toBe("GH_TOKEN=platform:conn:b\n");
    expect(logs).toContain("restarted Startup Item web for a new env");
  });

  // TEST_SCENARIO: one item that openrc fails to restart is logged, and the other items still get the new env.
  it("restarts the other items when one restart fails", async () => {
    const { env, restarted, logs } = harness({
      running: ["broken", "web"],
      failing: ["broken"],
    });

    await env.apply({ GH_TOKEN: "platform:conn:a" });
    expect(restarted).toEqual(["broken", "web"]);
    expect(logs).toContain(
      "Startup Item broken not restarted for a new env: rc-service: failed",
    );
  });

  // TEST_SCENARIO: two pushes close together run one after another, so an item never restarts twice at once, and the file ends with the latest env.
  it("applies quick pushes in order", async () => {
    const { dir, env, restarted } = harness({ running: ["web"] });

    await Promise.all([
      env.apply({ GH_TOKEN: "platform:conn:a" }),
      env.apply({ GH_TOKEN: "platform:conn:b" }),
    ]);
    expect(restarted).toEqual(["web", "web"]);
    expect(
      readFileSync(join(dir, ".config", "rc", "profile.env"), "utf8"),
    ).toBe("GH_TOKEN=platform:conn:b\n");
  });

  // TEST_SCENARIO: a container agent runs the same image without openrc, so it has no Startup Items: the runtime writes nothing into its home and restarts nothing.
  it("does nothing where openrc did not boot", async () => {
    const { dir, env, restarted } = harness({
      available: false,
      running: ["web"],
    });

    await env.apply({ GH_TOKEN: "x" });
    expect(existsSync(join(dir, ".config"))).toBe(false);
    expect(restarted).toEqual([]);
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
      setDisabled: async (id, value) => {
        if (id === "readonly") throw new Error("EROFS: read-only file system");
        disabled.set(id, value);
        return true;
      },
      remove: async (id) => {
        list = list.filter((i) => i.id !== id);
        return true;
      },
      logPath: (id) => `/logs/${id}.log`,
      run: async (action, id) => {
        runs.push(`${action} ${id}`);
        if (id === "broken" && action === "start") return "ctl failed";
        if (id === "stuck" && action === "stop")
          return "stuck is still running";
        return null;
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
      keep: {
        setKeptProcesses: () => {},
        setOpenLinks: () => {},
        taskKeepChanged: () => {},
      } as never,
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

  // TEST_SCENARIO: Remove stops the item and only then takes it out of the list; an item that will not stop stays listed and the user is told so. A choice the user made is kept even when the control fails, and the message says which part happened.
  it("removes an item only once it stopped, and says which part of a change happened", async () => {
    const { processes, runs } = service([
      { id: "web", command: "serve", disabled: false },
      { id: "stuck", command: "sleep infinity", disabled: false },
      { id: "broken", command: "false", disabled: true },
    ]);

    expect((await processes.removeStartupItem("web")).ok).toBe(true);
    const stuck = await processes.removeStartupItem("stuck");
    expect(stuck.ok ? null : stuck.error).toEqual({
      kind: "NotAllowed",
      message:
        "It could not be stopped, so it stays listed: stuck is still running",
    });
    expect((await processes.list()).startupItems.map((i) => i.id)).toEqual([
      "stuck",
      "broken",
    ]);
    const failed = await processes.setStartupItemEnabled("broken", true);
    expect(failed.ok ? null : failed.error).toEqual({
      kind: "NotAllowed",
      message:
        "It is on from the next wake, but could not start now: ctl failed",
    });
    expect(runs).toEqual(["stop web", "stop stuck", "start broken"]);
  });

  // TEST_SCENARIO: a change to the service on disk that fails is reported to the user, and nothing is stopped.
  it("reports a change on disk that fails", async () => {
    const { processes, runs } = service([
      { id: "readonly", command: "serve", disabled: false },
    ]);

    const result = await processes.setStartupItemEnabled("readonly", false);
    expect(result.ok ? null : result.error).toEqual({
      kind: "NotAllowed",
      message: "EROFS: read-only file system",
    });
    expect(runs).toEqual([]);
  });

  // TEST_SCENARIO: an item starts again at every wake and never keeps the agent awake, so the panel's keep choice is refused for it, as for a foreground process, rather than recorded as a choice that does nothing.
  it("refuses a keep choice on a Startup Item", async () => {
    const processes = createProcessesService({
      table: {
        scan: async () => ({
          scannedAt: Date.now(),
          processes: [
            proc(RUNTIME, 1, "node dist/server.js"),
            proc(300, 1, SUPERVISOR("web"), "web"),
          ],
        }),
        bootId: async () => "boot",
      },
      document: openProcessesDocument(
        createFileDocumentStoreBackend(mkdtempSync(join(tmpdir(), "state-"))),
      ),
      outputs: { tail: async () => null },
      signals: { send: () => true },
      keep: {
        setKeptProcesses: () => {},
        taskKeepChanged: () => {},
      } as never,
      runtimePid: RUNTIME,
      harnessWork: {
        harnesses: () => [],
        reportedTasks: () => [],
        forgetTask: () => {},
        pendingRestart: () => null,
        applyPendingRestart: () => false,
        onChange: () => {},
      },
      startupItems: { available: () => false } as never,
      log: () => {},
    });

    const result = await processes.setKeep("300:300", true);
    expect(result.ok ? null : result.error.kind).toBe("NotAllowed");
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
