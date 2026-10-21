import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { BIN_PATH, runDam } from "./run-dam.js";

const exec = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, "../..");

interface Fixture {
  url: string;
  setResponse: (res: { status?: number; body?: string | object }) => void;
  setNpmLatest: (latest: string | undefined) => void;
  close: () => Promise<void>;
}

const DIST_TAGS_PATH = "/-/package/%40dam-agents%2Fcli/dist-tags";

async function startFixture(): Promise<Fixture> {
  let response: { status: number; body: string } = {
    status: 200,
    body: JSON.stringify({ serverVersion: "1.0.0", minClientVersion: "0.0.0" }),
  };
  let npmLatest: string | undefined = "0.0.0";
  const server: Server = createServer((req, res) => {
    if (req.url === DIST_TAGS_PATH) {
      if (npmLatest === undefined) {
        res.writeHead(503).end();
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ latest: npmLatest, rc: `${npmLatest}-rc1` }));
      return;
    }
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
    setNpmLatest: (latest) => {
      npmLatest = latest;
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

  afterAll(async () => {});

  function env(): Record<string, string> {
    return {
      HOME: home,
      PATH: process.env.PATH ?? "",
      npm_config_registry: fixture.url,
    };
  }

  async function configureServer(url: string) {
    const dir = join(home, ".config", "dam");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "config.toml"), `server = "${url}"\n`);
  }

  it("no server configured: prints local line only, exit 0", async () => {
    const r = await runDam(["version"], env());
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe(`dam ${LOCAL}\nnpm latest 0.0.0`);
    expect(r.stdout).not.toContain("server");
    expect(r.stderr).toBe("");
  });

  it("reachable server: prints local + server lines, exit 0", async () => {
    fixture.setResponse({
      body: { serverVersion: "1.2.3", minClientVersion: "0.0.0" },
    });
    await configureServer(fixture.url);

    const r = await runDam(["version"], env());
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(`dam ${LOCAL}`);
    expect(r.stdout).toContain("server 1.2.3 (min CLI 0.0.0)");
    expect(r.stdout).toContain("npm latest 0.0.0");
  });

  it("server advertises no floor: omits the (min CLI ...) parenthetical", async () => {
    fixture.setResponse({
      body: { serverVersion: "1.2.3" },
    });
    await configureServer(fixture.url);

    const r = await runDam(["version"], env());
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(`dam ${LOCAL}`);
    expect(r.stdout).toContain("server 1.2.3");
    expect(r.stdout).not.toContain("min CLI");
    expect(r.stdout).not.toContain("undefined");
  });

  it("unreachable server: 'server unreachable' goes to stderr, exit 0", async () => {
    await configureServer("http://127.0.0.1:1");

    const r = await runDam(["version"], env());
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(`dam ${LOCAL}`);
    expect(r.stdout).not.toContain("server unreachable");
    expect(r.stderr).toContain("server unreachable");
  });

  it("BehindCurrent: warns to stderr, still exit 0, prints server line", async () => {
    fixture.setResponse({
      body: {
        serverVersion: "99.0.0",
        minClientVersion: "0.0.0",
        recommendedClientVersion: "99.0.0",
      },
    });
    await configureServer(fixture.url);

    const r = await runDam(["version"], env());
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toMatch(
      /warning:.*behind the server's recommended CLI 99\.0\.0/,
    );
    expect(r.stdout).toContain(
      "server 99.0.0 (min CLI 0.0.0, recommended CLI 99.0.0)",
    );
  });

  // TEST_SCENARIO: a dev server built from main reports `<version>-dev-<sha>` and recommends no CLI, so only npm can tell that the CLI is old. An agent reads the verdict from `--json` and must see that it is not up to date.
  it("dev server, npm has a newer CLI: warns, and --json says the CLI is not up to date", async () => {
    fixture.setResponse({
      body: { serverVersion: "0.2.24-dev-db35e8abf4bd" },
    });
    fixture.setNpmLatest("99.0.0");
    await configureServer(fixture.url);

    const text = await runDam(["version"], env());
    expect(text.exitCode).toBe(0);
    expect(text.stdout).toContain("server 0.2.24-dev-db35e8abf4bd\n");
    expect(text.stdout).toContain("npm latest 99.0.0");
    expect(text.stderr).toContain(
      `warning: CLI ${LOCAL} is behind 99.0.0, the latest on npm`,
    );
    expect(text.stderr).toContain("npm install -g @dam-agents/cli@latest");

    const json = await runDam(["version", "--json"], env());
    expect(json.exitCode).toBe(0);
    expect(JSON.parse(json.stdout)).toEqual({
      cliVersion: LOCAL,
      serverVersion: "0.2.24-dev-db35e8abf4bd",
      minClientVersion: null,
      recommendedClientVersion: null,
      latestCliVersion: "99.0.0",
      verdict: "ok",
      behindLatest: true,
      upToDate: false,
    });
  });

  it("--json: a current CLI is up to date", async () => {
    fixture.setResponse({
      body: {
        serverVersion: "1.0.0",
        minClientVersion: "0.0.0",
        recommendedClientVersion: "0.0.0",
      },
    });
    await configureServer(fixture.url);

    const r = await runDam(["version", "--json"], env());
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
    expect(JSON.parse(r.stdout)).toEqual({
      cliVersion: LOCAL,
      serverVersion: "1.0.0",
      minClientVersion: "0.0.0",
      recommendedClientVersion: "0.0.0",
      latestCliVersion: "0.0.0",
      verdict: "ok",
      behindLatest: false,
      upToDate: true,
    });
  });

  it("--json: below the floor gives verdict below-floor", async () => {
    fixture.setResponse({
      body: { serverVersion: "1.0.0", minClientVersion: "99.0.0" },
    });
    await configureServer(fixture.url);

    const r = await runDam(["version", "--json"], env());
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({
      verdict: "below-floor",
      minClientVersion: "99.0.0",
      upToDate: false,
    });
  });

  it("--json: nothing reachable reports nulls and the reasons, exit 0", async () => {
    fixture.setNpmLatest(undefined);
    await configureServer("http://127.0.0.1:1");

    const r = await runDam(["version", "--json"], env());
    expect(r.exitCode).toBe(0);
    const report = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(report).toMatchObject({
      cliVersion: LOCAL,
      serverVersion: null,
      latestCliVersion: null,
      verdict: null,
      behindLatest: null,
      upToDate: null,
    });
    expect(report.serverError).toEqual(expect.any(String));
    expect(report.latestError).toContain("503");
  });

  it("npm unreachable: says so on stderr, still prints the server line", async () => {
    fixture.setNpmLatest(undefined);
    await configureServer(fixture.url);

    const r = await runDam(["version"], env());
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("server 1.0.0 (min CLI 0.0.0)");
    expect(r.stdout).not.toContain("npm latest");
    expect(r.stderr).toContain("npm unreachable");
  });

  it("BelowFloor: stronger stderr warning, still exit 0 (informational, not gated)", async () => {
    fixture.setResponse({
      body: { serverVersion: "1.0.0", minClientVersion: "99.0.0" },
    });
    await configureServer(fixture.url);

    const r = await runDam(["version"], env());
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toContain(
      "below the server's minimum required version 99.0.0",
    );
    expect(r.stderr).toContain("ping/auth login/shell will fail");
    expect(r.stdout).toContain("server 1.0.0 (min CLI 99.0.0)");
    expect(r.stdout).not.toContain("ping/auth login/shell will fail");
  });

  it("relocated bin.js still resolves the version (build-time embed)", async () => {
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
