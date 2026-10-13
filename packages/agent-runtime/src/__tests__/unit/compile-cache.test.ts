// TEST_OVERVIEW: The runtime's launcher (src/main.ts) turns on Node's compile cache for the server bundle on a vm Backend machine only, keeps the cache in a directory next to the bundle, writes it before the process exits, and does not pass the cache on to a process the runtime starts.
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const launcher = new URL("../../main.ts", import.meta.url);

describe("agent-runtime compile cache", () => {
  let dist: string;

  beforeEach(() => {
    dist = join(mkdtempSync(join(tmpdir(), "compile-cache-")), "dist");
    mkdirSync(dist);
    copyFileSync(launcher, join(dist, "main.ts"));
    writeFileSync(
      join(dist, "server.js"),
      `import { execFileSync } from "node:child_process";
process.stdout.write(execFileSync(process.execPath, ["-p", "process.env.NODE_COMPILE_CACHE + ' ' + require('node:module').getCompileCacheDir()"]));
`,
    );
  });

  afterEach(() => {
    rmSync(join(dist, ".."), { recursive: true, force: true });
  });

  const start = (backend?: string) => {
    const run = spawnSync(process.execPath, [join(dist, "main.ts")], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        ...(backend ? { PLATFORM_BACKEND: backend } : {}),
      },
    });
    expect(run.status).toBe(0);
    return { stdout: run.stdout, stderr: run.stderr };
  };

  // TEST_SCENARIO: A machine's root outlives a boot, so the next start must find the bundle's compiled code in the cache directory next to it; the process the runtime starts must see no cache of its own.
  it("caches the bundle on a vm machine without passing the cache on", () => {
    expect(start("vm").stdout.trim()).toBe("undefined undefined");
    const cache = join(dist, "compile-cache");
    expect(readdirSync(cache, { recursive: true }).length).toBeGreaterThan(1);
  });

  // TEST_SCENARIO: A container's root is new on every start, so writing a cache there only costs time.
  it("writes no cache in a container", () => {
    start();
    expect(existsSync(join(dist, "compile-cache"))).toBe(false);
  });

  // TEST_SCENARIO: A cache directory the runtime cannot create must not stop the runtime from starting, and the log must say the cache is off.
  it("starts without the cache when it cannot be created, and says so", () => {
    writeFileSync(join(dist, "compile-cache"), "");
    const { stdout, stderr } = start("vm");
    expect(stdout.trim()).toBe("undefined undefined");
    expect(stderr).toContain("[runtime] compile cache off:");
  });
});
