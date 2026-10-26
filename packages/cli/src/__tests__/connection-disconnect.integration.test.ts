// TEST_OVERVIEW: `dam connection disconnect` deletes a connection's stored credential, which cannot be undone, so it confirms first. On a terminal it asks, naming the agents the connection is granted to. Without a terminal it refuses unless `--yes` is passed, and never calls the server's delete. Removing a GitHub sign-in removes every connection made from it, so the confirmation names each of them and the agents that lose it; removing one of those connections keeps the sign-in and says how to remove it.
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

const SIGN_IN: ConnectionView = {
  id: "conn-5191000000aa",
  ownerId: "fixture-user",
  templateId: "github",
  category: "app",
  name: "github",
  status: "active",
  authKind: "oauth",
  contributions: [],
  hosts: ["github.com"],
  isParent: true,
};
const { isParent: _isParent, ...CHILD_BASE } = SIGN_IN;
const FULL: ConnectionView = {
  ...CHILD_BASE,
  id: "conn-5191000000bb",
  parentId: SIGN_IN.id,
  fullAccess: true,
};
const DOCS: ConnectionView = {
  ...CHILD_BASE,
  id: "conn-5191000000cc",
  name: "github-docs",
  parentId: SIGN_IN.id,
};

const AGENTS = [
  makeAgent("agent-00000000000000aa", "scout"),
  makeAgent("agent-00000000000000bb", "writer"),
  makeAgent("agent-00000000000000cc", "reviewer"),
];
const GRANTS: Record<string, string[]> = {
  "agent-00000000000000aa": [CONNECTION.id, FULL.id],
  "agent-00000000000000bb": [DOCS.id],
  "agent-00000000000000cc": ["conn-000000000000", CONNECTION.id],
};

async function startFixture(
  deleted: string[],
): Promise<{ url: string; close: () => Promise<void> }> {
  const ctx = new Proxy(
    {
      agents: ownedAgents({ list: async () => AGENTS }),
      connections: {
        listAndReconcileConnections: async () => [
          CONNECTION,
          SIGN_IN,
          FULL,
          DOCS,
        ],
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
  /** TEST_SCENARIO: An agent's shell has no terminal. Removing a GitHub
   * sign-in without `--yes` exits 2 and names every connection made from it
   * with the agents that lose it, and nothing is deleted. The sign-in is
   * named by its id, since its name means its first connection. */
  it("names a sign-in's connections and their agents without --yes", async () => {
    const r = await run([SIGN_IN.id], false);

    expect(r.exitCode).toBe(2);
    expect(deleted).toEqual([]);
    expect(r.stderr).toContain(
      'The GitHub sign-in "github" (conn-5191000000aa) has 2 connection(s) made from it, which go with it:\n' +
        "  github (conn-5191000000bb): granted to 1 agent(s), which lose it: scout.\n" +
        "  github-docs (conn-5191000000cc): granted to 1 agent(s), which lose it: writer.\n",
    );
  });

  /** TEST_SCENARIO: On a terminal the command asks with that list, and after
   * yes removes the sign-in and reports the connections that went with it. */
  it("asks before it removes a sign-in with its connections", async () => {
    answer = true;
    const r = await run([SIGN_IN.id], true);

    expect(r.exitCode, `stderr: ${r.stderr}`).toBe(0);
    expect(deleted).toEqual([SIGN_IN.id]);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("github-docs (conn-5191000000cc)");
    expect(prompts[0]).toMatch(
      /Disconnect it\? This deletes its stored credential and every connection made from it, and cannot be undone\.$/,
    );
    expect(r.stdout).toBe(
      "✓ Disconnected the GitHub sign-in github (conn-5191000000aa) and the 2 connection(s) made from it: github, github-docs.\n",
    );
  });

  /** TEST_SCENARIO: With `--yes --json` the result lists the connections
   * removed with the sign-in. */
  it("lists the removed connections in --json", async () => {
    const r = await run([SIGN_IN.id, "--yes", "--json"], false);

    expect(r.exitCode, `stderr: ${r.stderr}`).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({
      ok: true,
      id: SIGN_IN.id,
      name: "github",
      connections: [
        { id: FULL.id, name: "github" },
        { id: DOCS.id, name: "github-docs" },
      ],
    });
  });

  /** TEST_SCENARIO: The name a sign-in shares with its first connection
   * removes the connection only; the sign-in stays, holding its credential,
   * and the command says how to remove it. */
  it("keeps the sign-in when one of its connections goes", async () => {
    const r = await run(["github", "--yes"], false);

    expect(r.exitCode, `stderr: ${r.stderr}`).toBe(0);
    expect(deleted).toEqual([FULL.id]);
    expect(r.stderr).toContain(
      "note: the GitHub sign-in github (conn-5191000000aa) it was made from stays, with 1 other connection(s); " +
        "remove it with `dam connection disconnect conn-5191000000aa`",
    );
  });
});
