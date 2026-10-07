import { describe, it, expect, afterEach } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  startDisplaySupervisor,
  type DisplaySupervisor,
} from "../../modules/browser-display.js";

// TEST_OVERVIEW: The runtime keeps the browser panel's display stack — platform-display, which runs the virtual display, its window manager, sound and stream server — running for as long as it runs: started again whenever it exits, and killed with everything it started.

const supervisors: DisplaySupervisor[] = [];
afterEach(() => {
  for (const s of supervisors.splice(0)) s.stop();
});

async function until(check: () => boolean, ms = 5_000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

function script(body: (dir: string) => string) {
  const dir = mkdtempSync(join(tmpdir(), "display-"));
  const path = join(dir, "platform-display");
  writeFileSync(path, `#!/bin/sh\n${body(dir)}\n`);
  chmodSync(path, 0o755);
  return { dir, path };
}

const lines = (file: string) => {
  try {
    return readFileSync(file, "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
};

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("display supervisor", () => {
  // TEST_SCENARIO: a part of the stack died — Selkies crashed, Xvfb was killed — so platform-display exited. It is started again, with a backoff, so the panel's picture comes back on its own; what the dead one started is killed first, so it cannot hold the display the next one needs.
  it("starts the stack again after it exits, killing what it left", async () => {
    const { dir, path } = script(
      (dir) =>
        `sleep 600 & echo $! >> "${dir}/children"; echo run >> "${dir}/runs"; exit 1`,
    );
    supervisors.push(
      startDisplaySupervisor({
        command: path,
        spawnEnv: () => process.env,
        log: () => {},
        backoffInitialMs: 20,
      }),
    );
    await until(() => lines(join(dir, "runs")).length >= 3);
    const children = lines(join(dir, "children")).map(Number);
    await until(() => children.slice(0, 2).every((pid) => !alive(pid)));
  });

  // TEST_SCENARIO: the runtime shutting down stops the stack and everything it started.
  it("kills the whole stack when stopped", async () => {
    const { dir, path } = script(
      (dir) => `sleep 600 & echo $! > "${dir}/child"; wait`,
    );
    const supervisor = startDisplaySupervisor({
      command: path,
      spawnEnv: () => process.env,
      log: () => {},
    });
    await until(() => lines(join(dir, "child")).length === 1);
    const child = Number(lines(join(dir, "child"))[0]);
    expect(alive(child)).toBe(true);
    supervisor.stop();
    await until(() => !alive(child));
  });
});
