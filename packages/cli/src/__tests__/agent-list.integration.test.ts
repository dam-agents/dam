import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "api-server-api/router";
import type { Agent, AgentsService, ApiContext } from "api-server-api";

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

/** Minimal fake api-server. Serves `/api/version` (for the compat
 *  pre-flight) and proxies tRPC routes to `appRouter` against a stub
 *  ApiContext where only `agents` is implemented; other ctx fields
 *  are populated lazily via a proxy that throws if touched, so a test
 *  that accidentally hits an unrelated route fails loudly. */
async function startFixture(opts: {
  list: () => Promise<Agent[]>;
  get?: (id: string) => Promise<Agent | null>;
  expectAuthorization?: string;
}): Promise<{ url: string; close: () => Promise<void> }> {
  const agents: Partial<AgentsService> = {
    list: opts.list,
    get: opts.get ?? (async () => null),
  };

  const ctx = new Proxy({ agents } as Record<string, unknown>, {
    get(target, prop) {
      if (prop in target) return target[prop as string];
      // `then` is probed by the runtime when awaiting a Promise — return
      // undefined so the value is treated as a plain object, not a
      // thenable.
      if (prop === "then") return undefined;
      throw new Error(
        `fake api-server: unexpected ctx access: ${String(prop)}`,
      );
    },
  }) as unknown as ApiContext;

  const server: Server = createServer(async (req, res) => {
    // Compat probe.
    if (req.url === "/api/version") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ serverVersion: "1.0.0", minClientVersion: "0.0.0" }),
      );
      return;
    }

    // tRPC routes — bridge node IncomingMessage to a Fetch Request.
    if (req.url?.startsWith("/api/trpc/")) {
      if (opts.expectAuthorization !== undefined) {
        const got = req.headers["authorization"];
        if (got !== opts.expectAuthorization) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "unauthorized" }));
          return;
        }
      }
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const fetchReq = new Request(`http://localhost${req.url}`, {
        method: req.method!,
        headers: Object.entries(req.headers).reduce<Record<string, string>>(
          (acc, [k, v]) => {
            if (typeof v === "string") acc[k] = v;
            return acc;
          },
          {},
        ),
        body: body && body.length > 0 ? body : undefined,
      });
      const fetchRes = await fetchRequestHandler({
        endpoint: "/api/trpc",
        req: fetchReq,
        router: appRouter,
        createContext: () => ctx,
      });
      res.writeHead(
        fetchRes.status,
        Object.fromEntries(fetchRes.headers.entries()),
      );
      const buf = Buffer.from(await fetchRes.arrayBuffer());
      res.end(buf);
      return;
    }

    res.writeHead(404).end();
  });

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (typeof addr !== "object" || addr === null) {
    throw new Error("fixture failed to bind");
  }
  return {
    url: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    name: "demo",
    templateId: "claude-code",
    spec: {
      name: overrides.name ?? "demo",
      image: "",
    },
    state: "running",
    channels: [],
    allowedUserEmails: [],
    ...overrides,
  };
}

describe("dam agent list (integration)", () => {
  // `dist/bin.js` is built once by `vitest.config.ts`'s globalSetup.

  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "dam-agentlist-"));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  afterAll(async () => {
    /* dist/ stays */
  });

  async function configureServer(url: string) {
    const r = await runDam(["config", "set", "server", url], {
      HOME: home,
      PATH: process.env.PATH ?? "",
    });
    expect(r.exitCode).toBe(0);
  }

  it("default text output: alphabetical 4-column table, exit 0", async () => {
    const fixture = await startFixture({
      list: async () => [
        makeAgent({
          id: "agent-2",
          name: "staging",
          templateId: "claude-code",
          state: "hibernated",
        }),
        makeAgent({ id: "agent-1", name: "prod", templateId: "claude-code" }),
        makeAgent({
          id: "agent-3",
          name: "test-x",
          templateId: "pi-agent",
          state: "error",
        }),
      ],
      expectAuthorization: "Bearer test-token",
    });
    try {
      await configureServer(fixture.url);

      const r = await runDam(["agent", "list"], {
        HOME: home,
        PATH: process.env.PATH ?? "",
        DAM_TOKEN: "test-token",
      });

      expect(r.exitCode, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      const lines = r.stdout.trimEnd().split("\n");
      expect(lines[0]).toMatch(/^NAME\s+ID\s+TEMPLATE\s+STATE$/);
      // Alphabetical sort: prod < staging < test-x
      expect(lines[1]).toContain("prod");
      expect(lines[2]).toContain("staging");
      expect(lines[3]).toContain("test-x");
      expect(lines[1]).toContain("agent-1");
      expect(lines[3]).toContain("error");
    } finally {
      await fixture.close();
    }
  });

  it("--json output: raw agent[] on stdout, exit 0", async () => {
    const agent = makeAgent({ id: "agent-42", name: "prod" });
    const fixture = await startFixture({
      list: async () => [agent],
      expectAuthorization: "Bearer test-token",
    });
    try {
      await configureServer(fixture.url);

      const r = await runDam(["agent", "list", "--json"], {
        HOME: home,
        PATH: process.env.PATH ?? "",
        DAM_TOKEN: "test-token",
      });

      expect(r.exitCode).toBe(0);
      const parsed = JSON.parse(r.stdout) as Array<{
        id: string;
        name: string;
      }>;
      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toMatchObject({ id: "agent-42", name: "prod" });
    } finally {
      await fixture.close();
    }
  });

  it("empty state: 'No agents.' to stderr, empty stdout, exit 0", async () => {
    const fixture = await startFixture({
      list: async () => [],
      expectAuthorization: "Bearer test-token",
    });
    try {
      await configureServer(fixture.url);

      const r = await runDam(["agent", "list"], {
        HOME: home,
        PATH: process.env.PATH ?? "",
        DAM_TOKEN: "test-token",
      });

      expect(r.exitCode).toBe(0);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain("No agents.");
    } finally {
      await fixture.close();
    }
  });

  it("bare `dam agent` aliases to `list` (commander isDefault)", async () => {
    const fixture = await startFixture({
      list: async () => [makeAgent()],
      expectAuthorization: "Bearer test-token",
    });
    try {
      await configureServer(fixture.url);

      const r = await runDam(["agent"], {
        HOME: home,
        PATH: process.env.PATH ?? "",
        DAM_TOKEN: "test-token",
      });

      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("demo");
      expect(r.stdout).toContain("NAME");
    } finally {
      await fixture.close();
    }
  });

  it("missing token (no auth.toml, no DAM_TOKEN): error directs user to dam auth login", async () => {
    const fixture = await startFixture({
      list: async () => [],
      // No expectAuthorization — the request never reaches the server
      // because the token provider aborts before the wire.
    });
    try {
      await configureServer(fixture.url);

      const r = await runDam(["agent", "list"], {
        HOME: home,
        XDG_STATE_HOME: home, // empty state → not-logged-in
        PATH: process.env.PATH ?? "",
      });

      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toContain("dam auth login");
    } finally {
      await fixture.close();
    }
  });
});
