// TEST_OVERVIEW: The Startup Items a starter kit declares become the agent's own openrc services at create, written as the agent would write them: a script in ~/.config/rc/init.d whose command and arguments openrc runs exactly as declared, a boot link when the kit has the item on, and a start now on a machine openrc booted. A script the agent already has under that name is never replaced, and the same event delivered twice changes nothing.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startupItemDeclarationSchema } from "agent-runtime-api";
import { startupItemScript } from "../../modules/processes/domain/startup-item-script.js";
import { createStartupItemStore } from "../../modules/processes/infrastructure/startup-items.js";
import { createDeclaredStartupItems } from "../../modules/processes/services/declared-startup-items.js";

const item = (raw: Record<string, unknown>) =>
  startupItemDeclarationSchema.parse(raw);

function argvOpenrcRuns(script: string): string[] {
  const dir = mkdtempSync(join(tmpdir(), "rc-script-"));
  const path = join(dir, "item");
  writeFileSync(path, script);
  const out = execFileSync(
    "sh",
    ["-c", `. "$1"; eval "printf '%s\\0' $command $command_args"`, "sh", path],
    { encoding: "utf8" },
  );
  return out.split("\0").slice(0, -1);
}

function setup(available = true) {
  const home = mkdtempSync(join(tmpdir(), "home-"));
  const store = createStartupItemStore(home);
  const runs: string[] = [];
  const logs: string[] = [];
  const declare = createDeclaredStartupItems({
    store: {
      ...store,
      available: () => available,
      run: async (action, id) => {
        runs.push(`${action} ${id}`);
        return id === "broken" ? "failed to start broken" : null;
      },
    },
    agentHome: home,
    log: (msg) => logs.push(msg),
  });
  const initDir = join(home, ".config", "rc", "init.d");
  const bootDir = join(home, ".config", "rc", "runlevels", "default");
  return { home, store, declare, runs, logs, initDir, bootDir };
}

describe("a kit's Startup Item script", () => {
  // TEST_SCENARIO: openrc evaluates command_args again when it starts the service, so an argument with spaces, quotes, `$`, backticks or a backslash reaches the program as the kit wrote it, never split or expanded; a command under ~/ is written with the agent's home, which the panel then shows.
  it("runs the program with the arguments exactly as declared", () => {
    const args = [
      "control-room",
      "two words",
      `it's "quoted"`,
      "$HOME",
      "`id`",
      "back\\slash",
      "",
    ];
    const script = startupItemScript(
      item({ name: "x", command: "~/bin/sd", args, description: `a "b" $c` }),
      "/home/agent",
      "from kit platform/dev@abc",
    );
    expect(script.startsWith("#!/sbin/openrc-run\n")).toBe(true);
    expect(argvOpenrcRuns(script)).toEqual(["/home/agent/bin/sd", ...args]);
    expect(script).toContain(`description="a \\"b\\" \\$c"`);
  });

  // TEST_SCENARIO: an item with no arguments writes no command_args, the shape an agent's own script has, and the panel shows its command alone.
  it("writes no arguments line for a bare program", () => {
    const script = startupItemScript(
      item({ name: "x", command: "python3" }),
      "/home/agent",
      "k",
    );
    expect(script).not.toContain("command_args");
    expect(argvOpenrcRuns(script)).toEqual(["python3"]);
  });
});

describe("writing a kit's Startup Items", () => {
  // TEST_SCENARIO: each item becomes a script the boot runs: on items get their boot link and start now, an off item is written without a link and not started, so the user finds both in the panel and can turn the off one on.
  it("writes each item, links the ones on at boot and starts them", async () => {
    const { declare, runs, initDir, bootDir, store } = setup();
    await declare({
      kit: "platform/dev@abc",
      items: [
        item({
          name: "web",
          command: "/usr/bin/python3",
          args: ["-m", "http.server"],
        }),
        item({ name: "watch", command: "watch", enabled: false }),
      ],
    });

    expect(statSync(join(initDir, "web")).mode & 0o777).toBe(0o755);
    expect(readlinkSync(join(bootDir, "web"))).toBe(join(initDir, "web"));
    expect(existsSync(join(bootDir, "watch"))).toBe(false);
    expect(runs).toEqual(["start web"]);
    expect(store.list()).toEqual([
      { id: "watch", command: "watch", disabled: true },
      {
        id: "web",
        command: "/usr/bin/python3 -m http.server",
        disabled: false,
      },
    ]);
    expect(readFileSync(join(initDir, "web"), "utf8")).toContain(
      "platform/dev@abc",
    );
  });

  // TEST_SCENARIO: an item the agent already wrote under the same name is the agent's, so the kit's is not written over it, its boot link is not touched and it is not started; the other items still go in.
  it("leaves an item the agent already has as it is", async () => {
    const { declare, runs, initDir, bootDir, logs } = setup();
    mkdirSync(initDir, { recursive: true });
    writeFileSync(join(initDir, "web"), "#!/sbin/openrc-run\ncommand=mine\n");

    await declare({
      kit: "k",
      items: [
        item({ name: "web", command: "theirs" }),
        item({ name: "api", command: "api" }),
      ],
    });

    expect(readFileSync(join(initDir, "web"), "utf8")).toContain(
      "command=mine",
    );
    expect(existsSync(join(bootDir, "web"))).toBe(false);
    expect(runs).toEqual(["start api"]);
    expect(logs.some((l) => l.includes("web") && l.includes("its own"))).toBe(
      true,
    );
  });

  // TEST_SCENARIO: the event can be delivered again after a runtime restart cut its settle short, so writing the same items twice leaves one script each and no stray draft file, and starts them again, which openrc treats as already started.
  it("writes the same items once when the event comes again", async () => {
    const { declare, initDir, store } = setup();
    const payload = {
      kit: "k",
      items: [item({ name: "web", command: "serve" })],
    };
    await declare(payload);
    await declare(payload);
    expect(store.list().map((i) => i.id)).toEqual(["web"]);
    expect(execFileSync("ls", ["-A", initDir], { encoding: "utf8" })).toBe(
      "web\n",
    );
  });

  // TEST_SCENARIO: a start that fails does not fail the event, which would hold every event behind it: the item is written and listed with its log, as one the agent wrote, and the failure is logged.
  it("logs a start that fails and goes on", async () => {
    const { declare, runs, logs } = setup();
    await declare({
      kit: "k",
      items: [
        item({ name: "broken", command: "nope" }),
        item({ name: "web", command: "serve" }),
      ],
    });
    expect(runs).toEqual(["start broken", "start web"]);
    expect(logs.some((l) => l.includes("failed to start broken"))).toBe(true);
  });

  // TEST_SCENARIO: a container agent runs the same image without openrc, so the scripts are written for a later machine but nothing is started.
  it("starts nothing where openrc did not boot", async () => {
    const { declare, runs, store } = setup(false);
    await declare({
      kit: "k",
      items: [item({ name: "web", command: "serve" })],
    });
    expect(runs).toEqual([]);
    expect(store.list().map((i) => i.id)).toEqual(["web"]);
  });
});
