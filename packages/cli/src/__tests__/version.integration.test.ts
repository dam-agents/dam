import { execFile } from "node:child_process";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

const exec = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, "../..");
const BIN_PATH = join(PKG_ROOT, "dist", "bin.js");

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runDam(
  args: string[],
  env: Record<string, string>,
): Promise<RunResult> {
  try {
    const { stdout, stderr } = await exec("node", [BIN_PATH, ...args], { env });
    return { exitCode: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return {
      exitCode: typeof err.code === "number" ? err.code : 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}

interface Fixture {
  url: string;
  setResponse: (res: { status?: number; body?: string | object }) => void;
  close: () => Promise<void>;
}

async function startFixture(): Promise<Fixture> {
  let response: { status: number; body: string } = {
    status: 200,
    body: JSON.stringify({ serverVersion: "1.0.0", minClientVersion: "0.0.0" }),
  };
  const server: Server = createServer((req, res) => {
    if (req.url !== "/api/version") {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(response.status, { "Content-Type": "application/json" });
    res.end(response.body);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (typeof addr !== "object" || addr === null) {
    throw new Error("fixture server failed to bind");
  }
  return {
    url: `http://127.0.0.1:${addr.port}`,
    setResponse: ({ status = 200, body }) => {
      response = {
        status,
        body: typeof body === "string" ? body : JSON.stringify(body ?? {}),
      };
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

async function readLocalCliVersion(): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const pkg = JSON.parse(
    await readFile(join(PKG_ROOT, "package.json"), "utf-8"),
  ) as { version: string };
  return pkg.version;
}

describe("dam version (integration)", () => {
  beforeAll(async () => {
    await exec("pnpm", ["exec", "tsup"], { cwd: PKG_ROOT });
  }, 60_000);

  let home: string;
  let fixture: Fixture;
  let LOCAL: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "dam-version-"));
    fixture = await startFixture();
    LOCAL = await readLocalCliVersion();
  });

  afterEach(async () => {
    await fixture.close();
    await rm(home, { recursive: true, force: true });
  });

  afterAll(async () => {
    /* dist/ persists across runs */
  });

  async function configureServer(url: string) {
    const r = await runDam(["config", "set", "server", url], {
      HOME: home,
      PATH: process.env.PATH ?? "",
    });
    expect(r.exitCode).toBe(0);
  }

  it("no server configured: prints local line only, exit 0", async () => {
    const r = await runDam(["version"], {
      HOME: home,
      PATH: process.env.PATH ?? "",
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe(`dam ${LOCAL}`);
    expect(r.stdout).not.toContain("server");
    expect(r.stderr).toBe("");
  });

  it("reachable server: prints local + server lines, exit 0", async () => {
    fixture.setResponse({
      body: { serverVersion: "1.2.3", minClientVersion: "0.0.0" },
    });
    await configureServer(fixture.url);

    const r = await runDam(["version"], {
      HOME: home,
      PATH: process.env.PATH ?? "",
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(`dam ${LOCAL}`);
    expect(r.stdout).toContain("server 1.2.3 (min CLI 0.0.0)");
  });

  it("server advertises no floor: omits the (min CLI ...) parenthetical", async () => {
    fixture.setResponse({
      body: { serverVersion: "1.2.3" },
    });
    await configureServer(fixture.url);

    const r = await runDam(["version"], {
      HOME: home,
      PATH: process.env.PATH ?? "",
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(`dam ${LOCAL}`);
    expect(r.stdout).toContain("server 1.2.3");
    expect(r.stdout).not.toContain("min CLI");
    expect(r.stdout).not.toContain("undefined");
  });

  it("unreachable server: 'server unreachable' goes to stderr, exit 0", async () => {
    await configureServer("http://127.0.0.1:1");

    const r = await runDam(["version"], {
      HOME: home,
      PATH: process.env.PATH ?? "",
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(`dam ${LOCAL}`);
    expect(r.stdout).not.toContain("server unreachable");
    expect(r.stderr).toContain("server unreachable");
  });

  it("BehindCurrent: warns to stderr, still exit 0, prints server line", async () => {
    fixture.setResponse({
      body: { serverVersion: "99.0.0", minClientVersion: "0.0.0" },
    });
    await configureServer(fixture.url);

    const r = await runDam(["version"], {
      HOME: home,
      PATH: process.env.PATH ?? "",
    });
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toMatch(/warning:.*behind server 99\.0\.0/);
    expect(r.stdout).toContain("server 99.0.0 (min CLI 0.0.0)");
  });

  it("BelowFloor: stronger stderr warning, still exit 0 (informational, not gated)", async () => {
    fixture.setResponse({
      body: { serverVersion: "1.0.0", minClientVersion: "99.0.0" },
    });
    await configureServer(fixture.url);

    const r = await runDam(["version"], {
      HOME: home,
      PATH: process.env.PATH ?? "",
    });
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toContain(
      "below the server's minimum required version 99.0.0",
    );
    expect(r.stderr).toContain("ping/auth login/shell will fail");
    // Server line goes to stdout; warning to stderr. stdout carries the
    // matter-of-fact status, stderr carries the human-facing diagnostic.
    expect(r.stdout).toContain("server 1.0.0 (min CLI 99.0.0)");
    expect(r.stdout).not.toContain("ping/auth login/shell will fail");
  });

  it("CONTRAST: same below-floor scenario — `version` exits 0, `ping` exits 3", async () => {
    fixture.setResponse({
      body: { serverVersion: "1.0.0", minClientVersion: "99.0.0" },
    });
    await configureServer(fixture.url);

    const v = await runDam(["version"], {
      HOME: home,
      PATH: process.env.PATH ?? "",
    });
    const p = await runDam(["ping"], {
      HOME: home,
      PATH: process.env.PATH ?? "",
    });

    expect(v.exitCode).toBe(0);
    expect(p.exitCode).toBe(3);
  });

  it("--server flag overrides configured server", async () => {
    fixture.setResponse({
      body: { serverVersion: "5.5.5", minClientVersion: "0.0.0" },
    });
    await configureServer("http://127.0.0.1:1");

    const r = await runDam(["version", "--server", fixture.url], {
      HOME: home,
      PATH: process.env.PATH ?? "",
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("server 5.5.5");
  });

  it("relocated bin.js still resolves the version (build-time embed)", async () => {
    // The version must be embedded in the bundle, not resolved by walking
    // up to a sibling package.json. Copy the built bin to a tmp dir away
    // from the repo and confirm `--version` prints the right string.
    // Use a `.mjs` extension so Node treats it as ESM without relying on a
    // sibling package.json (which is the whole point — no walk).
    const tmpDist = await mkdtemp(join(tmpdir(), "dam-relocated-"));
    try {
      const relocated = join(tmpDist, "bin.mjs");
      await copyFile(BIN_PATH, relocated);
      const { stdout } = await exec("node", [relocated, "--version"], {
        env: { HOME: home, PATH: process.env.PATH ?? "" },
      });
      expect(stdout.trim()).toBe(LOCAL);
    } finally {
      await rm(tmpDist, { recursive: true, force: true });
    }
  });
});
