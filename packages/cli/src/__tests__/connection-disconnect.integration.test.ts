// TEST_OVERVIEW: `dam connection disconnect` deletes a connection's stored credential, which cannot be undone, so it confirms first. On a terminal it asks, naming the agents the connection is granted to. Without a terminal it refuses unless `--yes` is passed, and never calls the server's delete.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prompts: string[] = [];
let answer = false;
vi.mock("../modules/shared/prompt.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../modules/shared/prompt.js")>()),
  confirm: vi.fn(async (question: string) => {
    prompts.push(question);
    return answer;
  }),
}));

import { runDam } from "./run-dam.js";
import { ownedAgents } from "./owned-agents.js";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "api-server-api/router";
import {
  ALL_SCOPES,
  type Agent,
  type ApiContext,
  type ConnectionView,
  type UserIdentity,
} from "api-server-api";

const FIXTURE_USER: UserIdentity = {
  sub: "fixture-user",
  preferredUsername: "fixture-user",
  scopes: ALL_SCOPES,
  agentIds: "*",
};

const CONNECTION: ConnectionView = {
  id: "conn-12878a3d36d4",
  ownerId: "fixture-user",
  templateId: "github-pat",
  category: "mcp",
  name: "github-scout",
  status: "active",
  authKind: "header",
  contributions: [],
  hosts: ["api.github.com"],
};

function makeAgent(id: string, name: string): Agent {
  return {
    id,
    name,
    templateId: "claude-code",
    spec: { name, image: "" },
    state: "hibernated",
    effectiveHibernationTimeoutMin: 60,
    features: { liveUpdates: true },
    stopRequested: false,
    disabled: false,
    overBudget: false,
    podRestarts: 0,
    contributionFailures: [],
    workspaceFailures: [],
    unsupportedContributionKinds: [],
    channels: [],
  };
}

const AGENTS = [
  makeAgent("agent-00000000000000aa", "scout"),
  makeAgent("agent-00000000000000bb", "writer"),
  makeAgent("agent-00000000000000cc", "reviewer"),
];
const GRANTS: Record<string, string[]> = {
  "agent-00000000000000aa": [CONNECTION.id],
  "agent-00000000000000bb": [],
  "agent-00000000000000cc": ["conn-000000000000", CONNECTION.id],
};

async function startFixture(
  deleted: string[],
): Promise<{ url: string; close: () => Promise<void> }> {
  const ctx = new Proxy(
    {
      agents: ownedAgents({ list: async () => AGENTS }),
      connections: {
        listAndReconcileConnections: async () => [CONNECTION],
        getAgentConnections: async (agentId: string) => ({
          agentId,
          connections: (GRANTS[agentId] ?? []).map((connectionId) => ({
            connectionId,
            grantedAt: "2026-10-21T00:00:00Z",
            preferred: false,
          })),
        }),
        deleteConnection: async (id: string) => {
          deleted.push(id);
        },
      },
      invocationsQuery: { listTargets: async () => [] },
      terms: { isAccepted: async () => true },
      user: FIXTURE_USER,
      actOnAgent: async () => ({ ok: true, ctx }),
    } as Record<string, unknown>,
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
      const fetchRes = await fetchRequestHandler({
        endpoint: "/api/trpc",
        req: new Request(`http://localhost${req.url}`, {
          method: req.method!,
          headers: Object.entries(req.headers).reduce<Record<string, string>>(
            (acc, [k, v]) => {
              if (typeof v === "string") acc[k] = v;
              return acc;
            },
            {},
          ),
          body: body && body.length > 0 ? body : undefined,
        }),
        router: appRouter,
        createContext: () => ctx,
      });
      res.writeHead(
        fetchRes.status,
        Object.fromEntries(fetchRes.headers.entries()),
      );
      res.end(Buffer.from(await fetchRes.arrayBuffer()));
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

describe("dam connection disconnect (integration)", () => {
  let home: string;
  let env: Record<string, string>;
  let deleted: string[];
  const isTTY = process.stdin.isTTY;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "dam-conndisconnect-"));
    env = { HOME: home, PATH: process.env.PATH ?? "", DAM_TOKEN: "test-token" };
    deleted = [];
    prompts.length = 0;
    answer = false;
  });

  afterEach(async () => {
    process.stdin.isTTY = isTTY;
    await rm(home, { recursive: true, force: true });
  });

  async function run(args: string[], tty: boolean) {
    process.stdin.isTTY = tty;
    const fixture = await startFixture(deleted);
    try {
      const dir = join(home, ".config", "dam");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "config.toml"), `server = "${fixture.url}"\n`);
      return await runDam(["connection", "disconnect", ...args], env);
    } finally {
      await fixture.close();
    }
  }

  /** TEST_SCENARIO: An agent's shell has no terminal. Without `--yes` the
   * command exits 2, names the flag and the agents that would lose the
   * connection, and the server's delete is never called. */
  it("refuses without --yes on non-interactive stdin", async () => {
    const r = await run(["github-scout"], false);

    expect(r.exitCode).toBe(2);
    expect(deleted).toEqual([]);
    expect(prompts).toEqual([]);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("pass `--yes`");
    expect(r.stderr).toContain(
      "It is granted to 2 agent(s), which lose it: scout, reviewer.",
    );
  });

  /** TEST_SCENARIO: With `--yes` the connection is deleted without a prompt,
   * on a terminal or not. */
  it("disconnects with --yes without asking", async () => {
    const r = await run(["github-scout", "--yes", "--json"], false);

    expect(r.exitCode, `stderr: ${r.stderr}`).toBe(0);
    expect(deleted).toEqual([CONNECTION.id]);
    expect(prompts).toEqual([]);
    expect(JSON.parse(r.stdout)).toEqual({
      ok: true,
      id: CONNECTION.id,
      name: "github-scout",
    });
  });

  /** TEST_SCENARIO: On a terminal the command asks, naming the agents the
   * connection is granted to; answering no cancels and deletes nothing. */
  it("asks on a terminal and cancels on no", async () => {
    const r = await run([CONNECTION.id], true);

    expect(r.exitCode, `stderr: ${r.stderr}`).toBe(0);
    expect(deleted).toEqual([]);
    expect(prompts).toEqual([
      'Disconnect "github-scout" (conn-12878a3d36d4)? This deletes its stored credential and cannot be undone. It is granted to 2 agent(s), which lose it: scout, reviewer.',
    ]);
    expect(r.stdout).toBe("Cancelled.\n");
  });

  /** TEST_SCENARIO: Answering yes on a terminal disconnects. */
  it("disconnects on a terminal after yes", async () => {
    answer = true;
    const r = await run(["github-scout"], true);

    expect(r.exitCode, `stderr: ${r.stderr}`).toBe(0);
    expect(deleted).toEqual([CONNECTION.id]);
    expect(r.stdout).toBe("✓ Disconnected github-scout (conn-12878a3d36d4).\n");
  });
});
