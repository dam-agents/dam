// TEST_OVERVIEW: An agent driving DAM sees and changes from the CLI what the agent's Providers page shows. `dam agent get` shows the granted model providers, the harnesses the runtime carries and the three Session Pair defaults, in its table and under `models` in its JSON. `dam agent update` grants and revokes provider Connections by name or id, saves a default through harnessConfig.rememberSessionPair with only the parts the flags name changed, and with --same-as-chat clears a channel or scheduled default. `dam agent models` lists the models a harness's providers offer, read from the agent-runtime's model catalog.
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "api-server-api/router";
import {
  ALL_SCOPES,
  type Agent,
  type ApiContext,
  type ConnectionView,
  type DefaultKind,
  type SessionDefaults,
  type SessionPair,
} from "api-server-api";
import { appRouter as runtimeRouter } from "agent-runtime-api/router";
import type {
  AgentRuntimeContext,
  HarnessCatalogView,
} from "agent-runtime-api";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDam } from "./run-dam.js";

const AGENT_ID = "agent-0000000000000001";

function connection(id: string, name: string, templateId: string) {
  return { id, name, templateId } as ConnectionView;
}

const CONNECTIONS = [
  connection("conn-ibm", "IBM proxy", "ibm-litellm"),
  connection("conn-oai", "My OpenAI", "openai"),
  connection("conn-gh", "github", "github"),
];

describe("dam agent get / update / models (integration)", () => {
  let home: string;
  let server: Server;
  let host: string;
  let granted: string[];
  let defaults: SessionDefaults;
  let remembered: { kind: DefaultKind; pair: SessionPair }[];
  let cleared: DefaultKind[];
  let grantCalls: { grant: string[]; revoke: string[] }[];
  let catalogHarness: string | null;
  let rememberRefusal: string | null;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "dam-agent-models-"));
    granted = ["conn-ibm", "conn-gh"];
    defaults = {
      chat: {
        harness: "claude-code",
        provider: "conn-ibm",
        model: "ibm/aws/claude-opus-4-8",
        settings: { effort: "high" },
      },
      channel: null,
      scheduled: {
        harness: "codex",
        provider: "conn-ibm",
        model: "ibm/gpt-5.5",
      },
    };
    remembered = [];
    cleared = [];
    grantCalls = [];
    catalogHarness = null;
    rememberRefusal = null;

    const apiContext = {
      user: { sub: "fixture-user", scopes: ALL_SCOPES, agentIds: "*" },
      terms: { isAccepted: async () => true },
      invocationsQuery: { listTargets: async () => [] },
      agents: {
        get: async (): Promise<Agent> => ({
          id: AGENT_ID,
          name: "demo",
          templateId: "default",
          spec: { name: "demo", image: "" },
          state: "running",
          effectiveHibernationTimeoutMin: 60,
          features: { liveUpdates: true },
          stopRequested: false,
          disabled: false,
          overBudget: false,
          podRestarts: 0,
          contributionFailures: [],
          unsupportedContributionKinds: [],
          workspaceFailures: [],
          channels: [],
        }),
      },
      connections: {
        listAndReconcileConnections: async () => CONNECTIONS,
        getAgentConnections: async (agentId: string) => ({
          agentId,
          connections: granted.map((connectionId) => ({
            connectionId,
            grantedAt: new Date(0).toISOString(),
            preferred: false,
          })),
        }),
        updateAgentConnections: async (
          _agentId: string,
          change: { grant: string[]; revoke: string[] },
        ) => {
          grantCalls.push(change);
          granted = [
            ...granted.filter((id) => !change.revoke.includes(id)),
            ...change.grant.filter((id) => !granted.includes(id)),
          ];
        },
      },
      harnessConfig: {
        status: async () => ({
          supported: true,
          catalog: null,
          sessionModel: true,
          modelRouter: true,
          followsDefaults: true,
          defaultHarness: "claude-code",
          harnesses: [
            { name: "claude-code", harnessConfig: true, sessionModel: true },
            { name: "codex", harnessConfig: true, sessionModel: true },
          ],
        }),
        sessionDefaults: async () => defaults,
        rememberSessionPair: async (
          _agentId: string,
          kind: DefaultKind,
          pair: SessionPair,
        ) => {
          if (rememberRefusal !== null) {
            const { TRPCError } = await import("@trpc/server");
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: rememberRefusal,
            });
          }
          remembered.push({ kind, pair });
          defaults = { ...defaults, [kind]: pair };
        },
        clearSessionDefault: async (
          _agentId: string,
          kind: Exclude<DefaultKind, "chat">,
        ) => {
          cleared.push(kind);
          defaults = { ...defaults, [kind]: null };
        },
      },
    } as unknown as ApiContext;

    const runtimeContext = {
      harnessConfig: {
        catalog: async ({
          harness,
        }: {
          harness: string;
        }): Promise<HarnessCatalogView> => {
          catalogHarness = harness;
          return {
            harness,
            routed: true,
            providers: [
              {
                connectionId: "conn-ibm",
                alias: "ibm",
                template: "ibm-litellm",
                displayName: "IBM ETE LiteLLM Proxy",
                status: "listed",
                listedAt: new Date(0).toISOString(),
                native: false,
                models: [
                  {
                    name: "ibm/gpt-5.5",
                    upstreamId: "gpt-5.5",
                    contextWindow: 400000,
                    maxOutputTokens: null,
                    reasoning: true,
                    vision: true,
                    prices: null,
                    source: { limits: "table", prices: "none" },
                  },
                ],
              },
              {
                connectionId: "conn-oai",
                alias: "openai",
                template: "openai",
                displayName: "OpenAI",
                status: "unavailable",
                listedAt: null,
                native: false,
                models: [],
              },
            ],
          };
        },
      },
    } as unknown as AgentRuntimeContext;

    server = createServer(async (req, res) => {
      if (req.url === "/api/version") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ serverVersion: "0.0.1", minClientVersion: "0.0.0" }),
        );
        return;
      }
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = Buffer.concat(chunks);
      const request = new Request(`http://localhost${req.url}`, {
        method: req.method!,
        headers: { "content-type": "application/json" },
        body: body.length > 0 ? body : undefined,
      });
      const response = req.url?.startsWith(`/api/agents/${AGENT_ID}/trpc/`)
        ? await fetchRequestHandler({
            endpoint: `/api/agents/${AGENT_ID}/trpc`,
            req: request,
            router: runtimeRouter,
            createContext: () => runtimeContext,
          })
        : await fetchRequestHandler({
            endpoint: "/api/trpc",
            req: request,
            router: appRouter,
            createContext: () => apiContext,
          });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    host = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((done) => server.close(() => done()));
    await rm(home, { recursive: true, force: true });
  });

  function dam(...args: string[]) {
    return runDam([...args, "--server", host], {
      HOME: home,
      XDG_CONFIG_HOME: home,
      XDG_STATE_HOME: home,
      DAM_TOKEN: "test-token",
    });
  }

  /**
   * TEST_SCENARIO: an agent told that a run needs a default model must be
   * able to check whether one is set, which providers it may use and which
   * harnesses it has, without a screenshot of the Providers page.
   */
  it("agent get shows the providers, harnesses and defaults", async () => {
    const r = await dam("agent", "get", AGENT_ID);
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^PROVIDERS:\s+IBM proxy \(ibm\)$/m);
    expect(r.stdout).toMatch(/^HARNESSES:\s+claude-code \(default\), codex$/m);
    expect(r.stdout).toMatch(
      /^DEFAULT:\s+ibm\/aws\/claude-opus-4-8 on claude-code \(effort=high\)$/m,
    );
    expect(r.stdout).toMatch(/^CHANNEL DEFAULT:\s+same as chat$/m);
    expect(r.stdout).toMatch(/^SCHEDULED DEFAULT:\s+ibm\/gpt-5\.5 on codex$/m);
  });

  /**
   * TEST_SCENARIO: a script parses `--json`, so the same facts are there,
   * beside the agent's own fields, with a default that is not set as null.
   */
  it("agent get --json carries the models object", async () => {
    defaults = { chat: null, channel: null, scheduled: null };
    const r = await dam("agent", "get", AGENT_ID, "--json");
    expect(r.exitCode, r.stderr).toBe(0);
    const parsed = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      id: AGENT_ID,
      models: {
        providers: [{ id: "conn-ibm", name: "IBM proxy", alias: "ibm" }],
        harnesses: ["claude-code", "codex"],
        defaultHarness: "claude-code",
        defaults: { chat: null, channel: null, scheduled: null },
      },
    });
  });

  /**
   * TEST_SCENARIO: a default whose model's provider is no longer granted
   * fails every run, so the table says so instead of looking set.
   */
  it("agent get warns about a default on a provider the agent lost", async () => {
    granted = ["conn-oai"];
    const r = await dam("agent", "get", AGENT_ID);
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).toMatch(
      /^DEFAULT:.*no ibm provider is granted, so runs fail$/m,
    );
  });

  /**
   * TEST_SCENARIO: changing only the model keeps the default's harness and
   * its settings, as the Providers page does when a model is picked.
   */
  it("agent update --model keeps the harness and settings", async () => {
    const r = await dam("agent", "update", AGENT_ID, "--model", "ibm/gpt-5.5");
    expect(r.exitCode, r.stderr).toBe(0);
    expect(remembered).toEqual([
      {
        kind: "chat",
        pair: {
          harness: "claude-code",
          provider: null,
          model: "ibm/gpt-5.5",
          settings: { effort: "high" },
        },
      },
    ]);
    expect(r.stdout).toMatch(/^DEFAULT:\s+ibm\/gpt-5\.5 on claude-code/m);
  });

  /**
   * TEST_SCENARIO: settings belong to one harness, so a new harness starts
   * the default without them unless --setting gives new ones.
   */
  it("agent update --harness drops the old harness's settings", async () => {
    const r = await dam(
      "agent",
      "update",
      AGENT_ID,
      "--harness",
      "codex",
      "--model",
      "ibm/gpt-5.5",
    );
    expect(r.exitCode, r.stderr).toBe(0);
    expect(remembered[0]?.pair).toEqual({
      harness: "codex",
      provider: null,
      model: "ibm/gpt-5.5",
    });
  });

  /**
   * TEST_SCENARIO: a channel or scheduled default starts from what that
   * kind runs on now: its own default when it has one, else the chat one.
   */
  it("agent update --kind channel starts from the chat default it follows", async () => {
    const r = await dam(
      "agent",
      "update",
      AGENT_ID,
      "--kind",
      "channel",
      "--setting",
      "effort=low",
    );
    expect(r.exitCode, r.stderr).toBe(0);
    expect(remembered).toEqual([
      {
        kind: "channel",
        pair: {
          harness: "claude-code",
          provider: null,
          model: "ibm/aws/claude-opus-4-8",
          settings: { effort: "low" },
        },
      },
    ]);
  });

  /**
   * TEST_SCENARIO: --same-as-chat is the CLI's "Same as chat" switch: it
   * clears the kind's own default instead of saving a copy of chat's.
   */
  it("agent update --same-as-chat clears the kind's own default", async () => {
    const r = await dam(
      "agent",
      "update",
      AGENT_ID,
      "--kind",
      "scheduled",
      "--same-as-chat",
    );
    expect(r.exitCode, r.stderr).toBe(0);
    expect(cleared).toEqual(["scheduled"]);
    expect(remembered).toEqual([]);
    expect(r.stdout).toMatch(/^SCHEDULED DEFAULT:\s+same as chat$/m);
  });

  /**
   * TEST_SCENARIO: providers are granted and revoked by name or id in one
   * call, and an unknown one stops the command before anything changes.
   */
  it("agent update grants and revokes providers by name or id", async () => {
    const r = await dam(
      "agent",
      "update",
      AGENT_ID,
      "--provider",
      "My OpenAI",
      "--remove-provider",
      "conn-ibm",
    );
    expect(r.exitCode, r.stderr).toBe(0);
    expect(grantCalls).toEqual([{ grant: ["conn-oai"], revoke: ["conn-ibm"] }]);
    expect(r.stdout).toMatch(/^PROVIDERS:\s+My OpenAI \(openai\)$/m);

    const unknown = await dam(
      "agent",
      "update",
      AGENT_ID,
      "--provider",
      "nope",
    );
    expect(unknown.exitCode).toBe(2);
    expect(unknown.stderr).toContain("unknown connection id or name: nope");
    expect(grantCalls).toHaveLength(1);
  });

  /**
   * TEST_SCENARIO: the server owns which pair is valid; its refusal reaches
   * the user word for word.
   */
  it("agent update prints the server's refusal", async () => {
    rememberRefusal = "this agent holds no anthropic provider";
    const r = await dam(
      "agent",
      "update",
      AGENT_ID,
      "--model",
      "anthropic/claude-opus-4-8",
    );
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("this agent holds no anthropic provider");
  });

  it("agent update with no change to make is invalid input", async () => {
    const r = await dam("agent", "update", AGENT_ID);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("nothing to change");
  });

  /**
   * TEST_SCENARIO: the model names to pass to --model come from the agent's
   * own catalog, for its default harness unless --harness names another,
   * and a provider that has not listed yet is named, not silently missing.
   */
  it("agent models lists the catalog's models as --model takes them", async () => {
    const r = await dam("agent", "models", AGENT_ID);
    expect(r.exitCode, r.stderr).toBe(0);
    expect(catalogHarness).toBe("claude-code");
    expect(r.stdout).toMatch(/^MODEL\s+PROVIDER\s+CONTEXT$/m);
    expect(r.stdout).toMatch(
      /^ibm\/gpt-5\.5\s+IBM ETE LiteLLM Proxy\s+400000$/m,
    );
    expect(r.stdout).toContain(
      "note: OpenAI has not listed its models yet; try again in a minute",
    );

    const json = await dam(
      "agent",
      "models",
      AGENT_ID,
      "--harness",
      "codex",
      "--json",
    );
    expect(json.exitCode, json.stderr).toBe(0);
    expect(catalogHarness).toBe("codex");
    expect(JSON.parse(json.stdout)).toMatchObject({ harness: "codex" });
  });
});
