// TEST_OVERVIEW: `dam agent disable` and `dam agent enable` resolve the Agent by name or id and call agents.setDisabled with the right flag. Success prints one line that says what wakes the Agent next. A runtime migration hold answers CONFLICT, which the CLI names and exits non-zero on. `dam agent list` and `get` show a disabled Agent's state as `disabled`.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDam } from "./run-dam.js";
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

async function startFixture(
  agents: Partial<AgentsService>,
): Promise<{ url: string; close: () => Promise<void> }> {
  const ctx = new Proxy(
    {
      agents,
      invocationsQuery: { listTargets: async () => [] },
      terms: { isAccepted: async () => true },
      user: FIXTURE_USER,
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

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-0000000000000001",
    name: "demo",
    templateId: "claude-code",
    spec: { name: overrides.name ?? "demo", image: "" },
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
    ...overrides,
  };
}

describe("dam agent disable / enable (integration)", () => {
  let home: string;
  let env: Record<string, string>;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "dam-agentdisable-"));
    env = { HOME: home, PATH: process.env.PATH ?? "", DAM_TOKEN: "test-token" };
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  async function withFixture(
    agents: Partial<AgentsService>,
    body: () => Promise<void>,
  ): Promise<void> {
    const fixture = await startFixture(agents);
    try {
      const dir = join(home, ".config", "dam");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "config.toml"), `server = "${fixture.url}"\n`);
      await body();
    } finally {
      await fixture.close();
    }
  }

  /** TEST_SCENARIO: Disable by name resolves the id through the list and sends
   * disabled=true. The line tells the owner how to undo it. */
  it("disable by name sends disabled=true and prints how to enable", async () => {
    const calls: [string, boolean][] = [];
    const agent = makeAgent({ id: "agent-00000000000000aa", name: "prod" });
    await withFixture(
      {
        list: async () => [agent],
        setDisabled: async (id, disabled) => {
          calls.push([id, disabled]);
          return { ok: true, value: { ...agent, disabled } };
        },
      },
      async () => {
        const r = await runDam(["agent", "disable", "prod"], env);

        expect(r.exitCode, `stderr: ${r.stderr}`).toBe(0);
        expect(calls).toEqual([["agent-00000000000000aa", true]]);
        expect(r.stdout).toBe(
          '✓ Disabled agent "prod". Nothing wakes it until you run `dam agent enable prod`.\n',
        );
      },
    );
  });

  /** TEST_SCENARIO: The CLI refuses a name two agents share, so when the
   * disabled agent's name is not unique the enable hint names it by id. */
  it("names the agent by id in the hint when its name is shared", async () => {
    const agent = makeAgent({ id: "agent-00000000000000aa", name: "twin" });
    const other = makeAgent({ id: "agent-00000000000000bb", name: "twin" });
    await withFixture(
      {
        list: async () => [agent, other],
        get: async () => agent,
        setDisabled: async (_id, disabled) => ({
          ok: true,
          value: { ...agent, disabled },
        }),
      },
      async () => {
        const r = await runDam(
          ["agent", "disable", "agent-00000000000000aa"],
          env,
        );

        expect(r.exitCode, `stderr: ${r.stderr}`).toBe(0);
        expect(r.stdout).toBe(
          '✓ Disabled agent "twin". Nothing wakes it until you run `dam agent enable agent-00000000000000aa`.\n',
        );
      },
    );
  });

  /** TEST_SCENARIO: Enable by id sends disabled=false. The Agent stays asleep,
   * so the line says only its next use wakes it. */
  it("enable by id sends disabled=false and says the next use wakes it", async () => {
    const calls: [string, boolean][] = [];
    const agent = makeAgent({
      id: "agent-00000000000000bb",
      name: "prod",
      disabled: true,
    });
    await withFixture(
      {
        get: async () => agent,
        setDisabled: async (id, disabled) => {
          calls.push([id, disabled]);
          return { ok: true, value: { ...agent, disabled } };
        },
      },
      async () => {
        const r = await runDam(
          ["agent", "enable", "agent-00000000000000bb"],
          env,
        );

        expect(r.exitCode, `stderr: ${r.stderr}`).toBe(0);
        expect(calls).toEqual([["agent-00000000000000bb", false]]);
        expect(r.stdout).toBe(
          '✓ Enabled agent "prod". It wakes on its next use.\n',
        );
      },
    );
  });

  /** TEST_SCENARIO: A runtime migration holds the Agent, so the server refuses
   * with CONFLICT. The CLI names the move and exits 1, for enable as well as
   * disable, since the server's own sentence only speaks of disabling. */
  it("a runtime migration hold exits 1 and names the move", async () => {
    const agent = makeAgent({ name: "prod" });
    await withFixture(
      {
        list: async () => [agent],
        setDisabled: async () => ({
          ok: false,
          error: { type: "RuntimeMigrating" },
        }),
      },
      async () => {
        const r = await runDam(["agent", "enable", "prod"], env);

        expect(r.exitCode).toBe(1);
        expect(r.stderr).toContain(
          'error: agent "prod" is moving to the new runtime; abort the move to enable it\n',
        );
      },
    );
  });

  /** TEST_SCENARIO: A disabled Agent's state reads `hibernated`, which hides
   * that nothing will wake it. List and get show `disabled` instead. */
  it("list and get show a disabled agent as disabled", async () => {
    const agent = makeAgent({ name: "prod", disabled: true });
    await withFixture(
      { list: async () => [agent], get: async () => agent },
      async () => {
        const list = await runDam(["agent", "list"], env);
        expect(list.exitCode, `stderr: ${list.stderr}`).toBe(0);
        expect(list.stdout).toMatch(/^prod\s+\S+\s+\S+\s+disabled\s*$/m);

        const get = await runDam(["agent", "get", agent.id], env);
        expect(get.exitCode, `stderr: ${get.stderr}`).toBe(0);
        expect(get.stdout).toMatch(/^STATE:\s+disabled$/m);
      },
    );
  });
});
