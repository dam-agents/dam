// TEST_OVERVIEW: `dam kit apply <agent> <kit>` sets a starter kit up on an agent that already exists, through starterKits.applyToAgent. It sends the agent's id, the connections the user named plus the ones the web app would preselect, counting the ones the agent already holds, and the schedules to skip. It prints what applied, what the agent keeps that only a create sets, and the setup that is left; the server's refusal of a conflict comes back as an error that says why.
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { TRPCError } from "@trpc/server";
import { appRouter } from "api-server-api/router";
import {
  ALL_SCOPES,
  type Agent,
  type ApiContext,
  type ConnectionTemplateView,
  type ConnectionView,
  type StarterKitApplyToAgentInput,
  type StarterKitApplyToAgentResult,
  type StarterKitView,
} from "api-server-api";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDam } from "./run-dam.js";
import { ownedAgents } from "./owned-agents.js";

const KIT_COMMIT = "a".repeat(40);

const RESEARCH: StarterKitView = {
  schemaVersion: "v1",
  id: "research",
  name: "Research desk",
  description: "Reads the papers you follow.",
  category: "research",
  seed: { url: "https://github.com/acme/research", into: "home" },
  egressRules: [],
  connections: [{ accepts: ["github"], required: true }],
  channels: [],
  schedules: [
    {
      name: "morning-brief",
      task: "Write the brief",
      cron: "0 7 * * *",
      enabled: true,
    },
  ],
  skills: [],
  env: [],
  startupItems: [],
  onboarding: false,
  catalog: "builtin",
  version: KIT_COMMIT,
  source: "https://github.com/acme/kits",
  skillsInKit: [],
};

const { onboarding: _none, ...BRIEFED } = RESEARCH;
const RESEARCH_ONBOARDING: StarterKitView = {
  ...BRIEFED,
  id: "onboarding",
  name: "Onboarding desk",
};

const TEMPLATES = [
  { id: "github", name: "GitHub", family: { id: "github", title: "GitHub" } },
] as ConnectionTemplateView[];

const CONNECTIONS = [
  { id: "conn-gh", name: "github", templateId: "github" },
] as ConnectionView[];

const HELPER: Agent = {
  id: "agent-0000000000000001",
  name: "helper",
  spec: { name: "helper", image: "" },
  state: "running",
  effectiveHibernationTimeoutMin: 60,
  features: { liveUpdates: true },
  stopRequested: false,
  overBudget: false,
  podRestarts: 0,
  contributionFailures: [],
  unsupportedContributionKinds: [],
  workspaceFailures: [],
  channels: [],
};

describe("dam kit apply (integration)", () => {
  let home: string;
  let server: Server;
  let host: string;
  let applied: StarterKitApplyToAgentInput[];
  let held: string[];
  let kept: StarterKitApplyToAgentResult["kept"];
  let refusal: TRPCError | null;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "dam-kit-apply-"));
    applied = [];
    held = [];
    kept = [];
    refusal = null;

    const apiContext = {
      user: { sub: "fixture-user", scopes: ALL_SCOPES, agentIds: "*" },
      actOnAgent: async () => ({ ok: true, ctx: apiContext }),
      terms: { isAccepted: async () => true },
      invocationsQuery: { listTargets: async () => [] },
      agents: ownedAgents({
        list: async () => [HELPER],
        get: async (id: string) => (id === HELPER.id ? HELPER : null),
      }),
      connections: {
        listTemplates: async () => TEMPLATES,
        listAndReconcileConnections: async () => CONNECTIONS,
        getAgentConnections: async (agentId: string) => ({
          agentId,
          connections: held.map((connectionId) => ({
            connectionId,
            grantedAt: new Date(0).toISOString(),
            preferred: false,
          })),
        }),
      },
      starterKits: {
        list: async () => [RESEARCH, RESEARCH_ONBOARDING],
        applyToAgent: async (input: StarterKitApplyToAgentInput) => {
          if (refusal) throw refusal;
          applied.push(input);
          return {
            agent: {
              ...HELPER,
              starterKit: `${input.catalog}/${input.kitId}@${KIT_COMMIT}`,
            },
            skills: null,
            skillsError: null,
            kept,
          };
        },
      },
    } as unknown as ApiContext;

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
      const response = await fetchRequestHandler({
        endpoint: "/api/trpc",
        req: new Request(`http://localhost${req.url}`, {
          method: req.method!,
          headers: { "content-type": "application/json" },
          body: body.length > 0 ? body : undefined,
        }),
        router: appRouter,
        createContext: () => apiContext,
        onError: () => {},
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

  /** TEST_SCENARIO: the issue's main path. The kit applies to the agent named, not to a new one, and the user learns what applied, where the kit's repository lands, and what is left. */
  it("applies the kit to the agent named, granting what the web app would", async () => {
    kept = [{ part: "storage", kit: "10Gi" }];
    const r = await dam("kit", "apply", "helper", "research");
    expect(r.exitCode, r.stderr).toBe(0);
    expect(applied).toEqual([
      {
        catalog: "builtin",
        kitId: "research",
        agentId: HELPER.id,
        connectionIds: ["conn-gh"],
        slackChannelIds: [],
        skipSchedules: [],
        scheduleOverrides: [],
      },
    ]);
    expect(r.stdout).toContain(
      `✓ Applied the starter kit Research desk (research) to agent "helper" (${HELPER.id}).`,
    );
    expect(r.stdout).toContain(
      "The kit's repository https://github.com/acme/research is checked out into the agent's home",
    );
    expect(r.stdout).toContain("Nothing is left to set up.");
    expect(r.stderr).toContain(
      "warning: the kit asks for 10Gi of storage; the agent keeps the size it was created with",
    );
  });

  /** TEST_SCENARIO: a connection the agent already holds meets the kit's need, so none is granted again and the step reads done. */
  it("counts the connections the agent holds toward the kit's needs", async () => {
    held = ["conn-gh"];
    const r = await dam("kit", "apply", "helper", "research", "--json");
    expect(r.exitCode, r.stderr).toBe(0);
    expect(applied[0]!.connectionIds).toEqual([]);
    const out = JSON.parse(r.stdout) as {
      agent: { id: string; starterKit: string };
      kit: string;
      kept: unknown[];
      steps: { kind: string; done: boolean }[];
    };
    expect(out.agent).toMatchObject({
      id: HELPER.id,
      starterKit: `builtin/research@${KIT_COMMIT}`,
    });
    expect(out.kit).toBe("research");
    expect(out.kept).toEqual([]);
    expect(out.steps).toEqual([
      expect.objectContaining({ kind: "connection", done: true }),
    ]);
  });

  /** TEST_SCENARIO: the scheduler holds every schedule of an agent whose kit onboarding is pending, so on an agent that had schedules before, the onboarding step says its own wait too. */
  it("says the agent's own schedules wait for the kit's onboarding", async () => {
    const r = await dam("kit", "apply", "helper", "onboarding", "--json");
    expect(r.exitCode, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout) as {
      steps: { kind: string; note?: string }[];
    };
    expect(out.steps).toContainEqual(
      expect.objectContaining({
        kind: "onboarding",
        note: "every schedule of the agent, its own included, waits until onboarding finishes",
      }),
    );
  });

  /** TEST_SCENARIO: a conflict the server finds — here a schedule the agent already has — is an input the user fixes, so it exits 2 with the server's reason. */
  it("says why the server refused the apply", async () => {
    refusal = new TRPCError({
      code: "CONFLICT",
      message:
        "the agent already has a schedule named morning-brief; rename it, or leave the kit's out with --skip-schedule",
    });
    const r = await dam("kit", "apply", "helper", "research");
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain(
      "error: failed to apply the starter kit: the agent already has a schedule named morning-brief",
    );
  });

  it("refuses a schedule the kit does not have, applying nothing", async () => {
    const r = await dam(
      "kit",
      "apply",
      "helper",
      "research",
      "--skip-schedule",
      "nightly",
    );
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("no schedule `nightly`");
    expect(applied).toEqual([]);
  });

  it("refuses an agent it cannot find, applying nothing", async () => {
    const r = await dam("kit", "apply", "nobody", "research");
    expect(r.exitCode).not.toBe(0);
    expect(applied).toEqual([]);
  });
});
