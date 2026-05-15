import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
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
  setResponse: (res: {
    status?: number;
    body?: string | object;
  }) => void;
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
  const url = `http://127.0.0.1:${addr.port}`;

  return {
    url,
    setResponse: ({ status = 200, body }) => {
      const serialized =
        typeof body === "string" ? body : JSON.stringify(body ?? {});
      response = { status, body: serialized };
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

describe("dam ping (integration)", () => {
  beforeAll(async () => {
    await exec("pnpm", ["exec", "tsup"], { cwd: PKG_ROOT });
  }, 60_000);

  let home: string;
  let fixture: Fixture;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "dam-ping-"));
    fixture = await startFixture();
  });

  afterEach(async () => {
    await fixture.close();
    await rm(home, { recursive: true, force: true });
  });

  afterAll(async () => {
    // dist/ stays for subsequent vitest runs.
  });

  async function configureServer(url: string) {
    const r = await runDam(["config", "set", "server", url], {
      HOME: home,
      PATH: process.env.PATH ?? "",
    });
    expect(r.exitCode).toBe(0);
  }

  it("Ok path: prints `ok — server <version>` and exits 0", async () => {
    fixture.setResponse({
      body: { serverVersion: "1.0.0", minClientVersion: "0.0.0" },
    });
    await configureServer(fixture.url);

    const r = await runDam(["ping"], {
      HOME: home,
      PATH: process.env.PATH ?? "",
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("ok — server 1.0.0");
  });

  it("server advertises no floor: still ok (exit 0)", async () => {
    fixture.setResponse({
      body: { serverVersion: "1.0.0" },
    });
    await configureServer(fixture.url);

    const r = await runDam(["ping"], {
      HOME: home,
      PATH: process.env.PATH ?? "",
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("ok — server 1.0.0");
  });

  it("BehindCurrent: warning on stderr, ok on stdout, exit 0", async () => {
    fixture.setResponse({
      body: { serverVersion: "99.0.0", minClientVersion: "0.0.0" },
    });
    await configureServer(fixture.url);

    const r = await runDam(["ping"], {
      HOME: home,
      PATH: process.env.PATH ?? "",
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("ok — server 99.0.0");
    expect(r.stderr).toMatch(/warning:.*behind server 99\.0\.0/);
  });

  it("BelowFloor: error on stderr, non-zero exit, no stdout", async () => {
    fixture.setResponse({
      body: { serverVersion: "1.0.0", minClientVersion: "99.0.0" },
    });
    await configureServer(fixture.url);

    const r = await runDam(["ping"], {
      HOME: home,
      PATH: process.env.PATH ?? "",
    });
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain("below the server's minimum required version 99.0.0");
    expect(r.stdout).not.toContain("ok");
  });

  it("missing config: setup hint on stderr, non-zero exit", async () => {
    const r = await runDam(["ping"], {
      HOME: home,
      PATH: process.env.PATH ?? "",
    });
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain("no server configured");
    expect(r.stderr).toContain('dam config set server');
    expect(r.stderr).toContain("DAM_SERVER");
  });

  it("unreachable server: network error on stderr, non-zero exit", async () => {
    // Use a port that won't accept connections (1 is privileged + unused).
    await configureServer("http://127.0.0.1:1");

    const r = await runDam(["ping"], {
      HOME: home,
      PATH: process.env.PATH ?? "",
    });
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/cannot reach server|server did not respond/);
  });

  it("--server flag overrides configured server", async () => {
    fixture.setResponse({
      body: { serverVersion: "1.0.0", minClientVersion: "0.0.0" },
    });
    // Configure a bogus server; --server should override.
    await configureServer("http://127.0.0.1:1");

    const r = await runDam(["ping", "--server", fixture.url], {
      HOME: home,
      PATH: process.env.PATH ?? "",
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("ok — server 1.0.0");
  });
});
