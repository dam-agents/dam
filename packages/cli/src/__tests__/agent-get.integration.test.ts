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
import {
  ALL_SCOPES,
  type Agent,
  type AgentsService,
  type ApiContext,
  type UserIdentity,
} from "api-server-api";

const FIXTURE_USER: UserIdentity = {
  sub: "fixture-user",
  preferredUsername: "fixture-user",
  scopes: ALL_SCOPES,
  agentIds: "*",
};

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

async function startFixture(opts: {
  list?: () => Promise<Agent[]>;
  get?: (id: string) => Promise<Agent | null>;
}): Promise<{ url: string; close: () => Promise<void> }> {
  const agents: Partial<AgentsService> = {
    list: opts.list ?? (async () => []),
    get: opts.get ?? (async () => null),
  };

  const ctx = new Proxy(
    { agents, user: FIXTURE_USER } as Record<string, unknown>,
    {
      get(target, prop) {
        if (prop in target) return target[prop as string];
        if (prop === "then") return undefined;
        throw new Error(
          `fake api-server: unexpected ctx access: ${String(prop)}`,
        );
      },
    },
  ) as unknown as ApiContext;

  const server: Server = createServer(async (req, res) => {
    if (req.url === "/api/version") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ serverVersion: "1.0.0", minClientVersion: "0.0.0" }),
      );
      return;
    }

    if (req.url?.startsWith("/api/trpc/")) {
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
    effectiveHibernationTimeoutMin: 60,
    contributionFailures: [],
    channels: [],
    allowedUserEmails: [],
    ...overrides,
  };
}

describe("dam agent get (integration)", () => {
  // `dist/bin.js` is built once by `vitest.config.ts`'s globalSetup.

  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "dam-agentget-"));
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

  it("get by id: prints the vertical layout, exit 0", async () => {
    const agent = makeAgent({
      id: "agent-42",
      name: "prod",
      templateId: "claude-code",
      spec: {
        name: "prod",
        image: "registry.example.com/claude-code:latest",
        description: "My prod environment",
      },
      allowedUserEmails: ["alice@example.com", "bob@example.com"],
    });
    const fixture = await startFixture({
      get: async (id) => (id === "agent-42" ? agent : null),
    });
    try {
      await configureServer(fixture.url);

      const r = await runDam(["agent", "get", "agent-42"], {
        HOME: home,
        PATH: process.env.PATH ?? "",
        DAM_TOKEN: "test-token",
      });

      expect(r.exitCode, `stderr: ${r.stderr}`).toBe(0);
      expect(r.stdout).toMatch(/^NAME:\s+prod$/m);
      expect(r.stdout).toMatch(/^ID:\s+agent-42$/m);
      expect(r.stdout).toMatch(/^TEMPLATE:\s+claude-code$/m);
      expect(r.stdout).toMatch(
        /^IMAGE:\s+registry\.example\.com\/claude-code:latest$/m,
      );
      expect(r.stdout).toMatch(/^STATE:\s+running$/m);
      expect(r.stdout).toMatch(/^DESCRIPTION:\s+My prod environment$/m);
      expect(r.stdout).toMatch(
        /^ALLOWED:\s+alice@example\.com, bob@example\.com$/m,
      );
    } finally {
      await fixture.close();
    }
  });

  it("get by name: same output, resolver picks the right agent", async () => {
    const agent = makeAgent({ id: "agent-77", name: "staging" });
    const fixture = await startFixture({
      list: async () => [makeAgent({ id: "agent-99", name: "prod" }), agent],
    });
    try {
      await configureServer(fixture.url);

      const r = await runDam(["agent", "get", "staging"], {
        HOME: home,
        PATH: process.env.PATH ?? "",
        DAM_TOKEN: "test-token",
      });

      expect(r.exitCode, `stderr: ${r.stderr}`).toBe(0);
      expect(r.stdout).toMatch(/^NAME:\s+staging$/m);
      expect(r.stdout).toMatch(/^ID:\s+agent-77$/m);
    } finally {
      await fixture.close();
    }
  });

  it("get by id 404: stderr references the id, exit 5", async () => {
    const fixture = await startFixture({
      get: async () => null,
    });
    try {
      await configureServer(fixture.url);

      const r = await runDam(["agent", "get", "agent-nope"], {
        HOME: home,
        PATH: process.env.PATH ?? "",
        DAM_TOKEN: "test-token",
      });

      expect(r.exitCode).toBe(5);
      expect(r.stderr).toContain("no agent with id `agent-nope`");
    } finally {
      await fixture.close();
    }
  });

  it("get by name not-found: stderr references the name, exit 5", async () => {
    const fixture = await startFixture({
      list: async () => [makeAgent({ name: "staging" })],
    });
    try {
      await configureServer(fixture.url);

      const r = await runDam(["agent", "get", "prod"], {
        HOME: home,
        PATH: process.env.PATH ?? "",
        DAM_TOKEN: "test-token",
      });

      expect(r.exitCode).toBe(5);
      expect(r.stderr).toContain('no agent named "prod"');
    } finally {
      await fixture.close();
    }
  });

  it("get by name ambiguous: stderr lists matches, exit 5", async () => {
    const fixture = await startFixture({
      list: async () => [
        makeAgent({ id: "agent-A", name: "prod" }),
        makeAgent({ id: "agent-B", name: "prod" }),
        makeAgent({ id: "agent-C", name: "other" }),
      ],
    });
    try {
      await configureServer(fixture.url);

      const r = await runDam(["agent", "get", "prod"], {
        HOME: home,
        PATH: process.env.PATH ?? "",
        DAM_TOKEN: "test-token",
      });

      expect(r.exitCode).toBe(5);
      expect(r.stderr).toContain('multiple agents named "prod"');
      expect(r.stderr).toContain("agent-A");
      expect(r.stderr).toContain("agent-B");
      expect(r.stderr).not.toContain("agent-C");
      expect(r.stderr).toContain("hint: specify by id instead");
    } finally {
      await fixture.close();
    }
  });

  it("--json output: raw agent on stdout", async () => {
    const agent = makeAgent({ id: "agent-42", name: "prod" });
    const fixture = await startFixture({
      get: async () => agent,
    });
    try {
      await configureServer(fixture.url);

      const r = await runDam(["agent", "get", "agent-42", "--json"], {
        HOME: home,
        PATH: process.env.PATH ?? "",
        DAM_TOKEN: "test-token",
      });

      expect(r.exitCode, `stderr: ${r.stderr}`).toBe(0);
      const parsed = JSON.parse(r.stdout) as { id: string; name: string };
      expect(parsed).toMatchObject({ id: "agent-42", name: "prod" });
    } finally {
      await fixture.close();
    }
  });
});
