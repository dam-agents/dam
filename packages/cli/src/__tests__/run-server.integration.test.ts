import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";
import { runDam } from "./run-dam.js";
import { ownedAgents } from "./owned-agents.js";
import { signInEnv, writeSavedSignIns } from "./saved-sign-ins.js";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "api-server-api/router";
import {
  ALL_SCOPES,
  type Agent,
  type ApiContext,
  type UserIdentity,
} from "api-server-api";

/**
 * TEST_OVERVIEW: `dam run get` and `dam run cancel` given `--server` send
 * every request to that server — the version probe, the agent lookup and the
 * ACP connection — and none to the active one (#6064). `run` and its
 * subcommands each declare `--server`; the subcommand's flag must reach the
 * subcommand, not the parent.
 */

const FIXTURE_USER: UserIdentity = {
  sub: "fixture-user",
  preferredUsername: "fixture-user",
  scopes: ALL_SCOPES,
  agentIds: "*",
};

interface Fixture {
  url: string;
  requests: string[];
  frames: string[];
  close: () => Promise<void>;
}

async function startServer(agents: Agent[]): Promise<Fixture> {
  const ctx = new Proxy(
    {
      agents: ownedAgents({
        list: async () => agents,
        get: async (id) => agents.find((a) => a.id === id) ?? null,
      }),
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

  const requests: string[] = [];
  const frames: string[] = [];
  const server: Server = createServer(async (req, res) => {
    requests.push(req.url ?? "");
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

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    requests.push(req.url ?? "");
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on("message", (data) => {
        const frame = JSON.parse(String(data)) as {
          id?: number;
          method?: string;
        };
        frames.push(frame.method ?? "");
        if (frame.id === undefined) return;
        const result =
          frame.method === "platform/runResult" ? { status: "pending" } : {};
        ws.send(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result }));
      });
    });
  });

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (typeof addr !== "object" || addr === null) {
    throw new Error("fixture failed to bind");
  }
  return {
    url: `http://127.0.0.1:${addr.port}`,
    requests,
    frames,
    close: () =>
      new Promise<void>((r) => {
        wss.close();
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-0000000000000001",
    name: "demo",
    templateId: "claude-code",
    spec: { name: overrides.name ?? "demo", image: "" },
    state: "running",
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
    ...overrides,
  };
}

describe("dam run get/cancel --server (integration)", () => {
  let home: string;
  let prod: Fixture;
  let dev: Fixture;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "dam-runserver-"));
    prod = await startServer([]);
    dev = await startServer([
      makeAgent({ id: "agent-0000000000000042", name: "dev-agent" }),
    ]);
    await writeSavedSignIns(
      home,
      [{ host: prod.url }, { host: dev.url }],
      prod.url,
    );
  });

  afterEach(async () => {
    await prod.close();
    await dev.close();
    await rm(home, { recursive: true, force: true });
  });

  /** TEST_SCENARIO: the agent lives only on the saved server that is not active; `run get --server` finds it there and reads its run result there. */
  it("run get looks the agent up and reads the run on --server", async () => {
    const r = await runDam(
      ["run", "get", "dev-agent", "sess-1", "--server", dev.url, "--json"],
      signInEnv(home),
    );

    expect(r.exitCode, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ status: "pending" });
    expect(dev.requests).toContain(
      "/api/agents/agent-0000000000000042/acp?token=saved-access",
    );
    expect(dev.frames).toContain("platform/runResult");
    expect(prod.requests).toEqual([]);
  });

  /** TEST_SCENARIO: `run cancel --server` sends the lookup and the cancel to that server, and nothing to the active one. */
  it("run cancel looks the agent up and cancels on --server", async () => {
    const r = await runDam(
      ["run", "cancel", "dev-agent", "sess-1", "--server", dev.url],
      signInEnv(home),
    );

    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stderr).toBe("cancel sent\n");
    await vi.waitFor(() => expect(dev.frames).toContain("session/cancel"));
    expect(prod.requests).toEqual([]);
  });
});
