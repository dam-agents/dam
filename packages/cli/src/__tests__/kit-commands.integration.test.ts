// TEST_OVERVIEW: A user's agent does with starter kits from the CLI what the web app's kit pages do. `dam kit list` lists each kit with the Kit Ref the other commands take, its name and description. `dam kit show` lists what a kit sets up and each thing it needs, marked required or suggested, with the `dam` command that sets it up, and refuses a kit it cannot find with an error that names it and points at `dam kit list`. `dam agent create --kit` applies the kit through starterKits.create with the connections the web app would grant and lists the setup that is left. `dam agent get` names the kit an agent came from and its update state, and `dam kit update` starts the update as the web app's Update button does.
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
  type KitUpdateStatus,
  type StarterKitApplyInput,
  type StarterKitView,
} from "api-server-api";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDam } from "./run-dam.js";
import { ownedAgents } from "./owned-agents.js";

const KIT_COMMIT = "a".repeat(40);
const LATEST_COMMIT = "b".repeat(40);

function kit(over: Partial<StarterKitView>): StarterKitView {
  return {
    schemaVersion: "v1",
    id: "kit",
    name: "Kit",
    description: "A kit.",
    category: "research",
    egressRules: [],
    connections: [],
    channels: [],
    schedules: [],
    skills: [],
    env: [],
    startupItems: [],
    catalog: "builtin",
    version: KIT_COMMIT,
    source: "https://github.com/acme/kits",
    skillsInKit: [],
    ...over,
  };
}

const RESEARCH = kit({
  id: "research",
  name: "Research desk",
  description: "Reads the papers you follow and briefs you every morning.",
  seed: { url: "https://github.com/acme/research", into: "work" },
  skillsInKit: [{ name: "brief", description: "Writes the morning brief" }],
  connections: [
    {
      accepts: ["github"],
      required: true,
      note: "Reads the reading list.",
    },
    { accepts: ["modal"], required: false },
  ],
  channels: [{ type: "slack", conversation: "channel" }],
  schedules: [
    {
      name: "morning-brief",
      task: "Write the brief",
      cron: "0 7 * * *",
      enabled: true,
    },
  ],
});
const PLAIN = kit({ id: "plain", name: "Plain", onboarding: false });
const LINKED = kit({
  id: "desk",
  name: "Linked desk",
  catalog: "link",
  link: { url: "https://github.com/acme/desk" },
  onboarding: false,
});
const ESC = "\x1b";
const HOSTILE = kit({
  id: "hostile",
  name: `Hostile${ESC}[2K`,
  install: { command: "make setup" },
  env: [{ name: "TOKEN", value: `x\r${ESC}[1A${ESC}[2Kinstall: true` }],
  connections: [{ accepts: ["x;touch /tmp/p;"], required: true }],
  schedules: [{ name: "a>b", task: "Write", cron: "0 7 * * *", enabled: true }],
  link: { url: "https://github.com/acme/hostile" },
  catalog: "link",
});

const TEMPLATES = [
  { id: "github", name: "GitHub", family: { id: "github", title: "GitHub" } },
  { id: "modal", name: "Modal", family: { id: "modal", title: "Modal" } },
] as ConnectionTemplateView[];

const CONNECTIONS = [
  { id: "conn-gh", name: "github", templateId: "github" },
  { id: "conn-ibm", name: "IBM proxy", templateId: "ibm-litellm" },
] as ConnectionView[];

function agent(over: Partial<Agent>): Agent {
  return {
    id: "agent-0000000000000001",
    name: "desk",
    spec: { name: "desk", image: "" },
    state: "starting",
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
    ...over,
  };
}

describe("dam kit and dam agent create --kit (integration)", () => {
  let home: string;
  let server: Server;
  let host: string;
  let agents: Agent[];
  let applied: StarterKitApplyInput[];
  let updates: KitUpdateStatus[];
  let started: string[];
  let scopes: readonly string[];
  let inspected: Record<string, StarterKitView>;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "dam-kit-"));
    agents = [];
    applied = [];
    updates = [];
    started = [];
    scopes = ALL_SCOPES;
    inspected = {};

    const apiContext = {
      user: {
        sub: "fixture-user",
        get scopes() {
          return scopes;
        },
        agentIds: "*",
      },
      actOnAgent: async () => ({ ok: true, ctx: apiContext }),
      terms: { isAccepted: async () => true },
      invocationsQuery: { listTargets: async () => [] },
      agents: ownedAgents({
        list: async () => agents,
        get: async (id: string) => agents.find((a) => a.id === id) ?? null,
      }),
      connections: {
        listTemplates: async () => TEMPLATES,
        listAndReconcileConnections: async () => CONNECTIONS,
        getAgentConnections: async (agentId: string) => ({
          agentId,
          connections: [],
        }),
      },
      starterKits: {
        list: async () => [RESEARCH, PLAIN],
        inspect: async (url: string) => {
          const found = inspected[url];
          if (found) return found;
          throw new TRPCError({ code: "BAD_GATEWAY", message: "not a kit" });
        },
        apply: async (input: StarterKitApplyInput) => {
          applied.push(input);
          const created = agent({
            name: input.name,
            spec: { name: input.name, image: "" },
            starterKit: `${input.catalog}/${input.kitId}@${KIT_COMMIT}`,
          });
          agents.push(created);
          return { agent: created, skills: null, skillsError: null };
        },
        updates: async () => updates,
        updateChanges: async () => null,
        startUpdate: async (agentId: string) => {
          started.push(agentId);
          return {
            agentId,
            state: "pending",
            current: KIT_COMMIT,
            latest: LATEST_COMMIT,
            pending: {
              targetCommit: LATEST_COMMIT,
              startedAt: new Date(0).toISOString(),
            },
          };
        },
        skipUpdate: async () => {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "no kit update to skip: up-to-date",
          });
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

  /** TEST_SCENARIO: an agent asked which kits a deployment offers must find them under `dam kit`, not answer with templates (AC-1). */
  it("lists each kit with its ref, name and description", async () => {
    const table = await dam("kit", "list");
    expect(table.exitCode, table.stderr).toBe(0);
    expect(table.stdout).toMatch(/^plain\s+Plain\s+research\s+A kit\.$/m);
    expect(table.stdout).toMatch(/^research\s+Research desk\s+research\s+/m);

    const json = await dam("kit", "list", "--json");
    expect(json.exitCode, json.stderr).toBe(0);
    expect(
      (JSON.parse(json.stdout) as StarterKitView[]).map((k) => ({
        ref: (k as StarterKitView & { ref: string }).ref,
        name: k.name,
        description: k.description,
      })),
    ).toEqual([
      {
        ref: "research",
        name: "Research desk",
        description: RESEARCH.description,
      },
      { ref: "plain", name: "Plain", description: PLAIN.description },
    ]);
  });

  /** TEST_SCENARIO: before the user picks a kit, the agent must say what it brings and what the user still sets up, and which of that is required (AC-2). */
  it("shows what a kit sets up and what it needs, with the command for each", async () => {
    const r = await dam("kit", "show", "research", "--json");
    expect(r.exitCode, r.stderr).toBe(0);
    const shown = JSON.parse(r.stdout) as {
      ref: string;
      seeds: { kind: string; what: string }[];
      needs: {
        kind: string;
        required: boolean;
        what: string;
        command: string;
      }[];
    };
    expect(shown.ref).toBe("research");
    expect(shown.seeds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "repository",
          what: "https://github.com/acme/research",
        }),
        expect.objectContaining({ kind: "skill", what: "brief" }),
        expect.objectContaining({ kind: "schedule", what: "morning-brief" }),
      ]),
    );
    expect(shown.needs).toEqual([
      {
        kind: "connection",
        required: true,
        what: "GitHub",
        note: "Reads the reading list.",
        command: "dam agent create <name> --kit <kit> --connection github",
      },
      {
        kind: "connection",
        required: false,
        what: "Modal",
        command:
          "dam connection connect modal, then dam agent create <name> --kit <kit> --connection <connection>",
      },
      {
        kind: "channel",
        required: false,
        what: "Slack channel",
        command:
          "dam agent create <name> --kit <kit> --slack-channel <channel-id>",
      },
      {
        kind: "schedule",
        required: false,
        what: "morning-brief",
        command:
          "created with the agent; leave it out with dam agent create <name> --kit <kit> --skip-schedule morning-brief",
      },
    ]);

    const table = await dam("kit", "show", "research");
    expect(table.exitCode, table.stderr).toBe(0);
    expect(table.stdout).toMatch(
      /GitHub \(required\) — Reads the reading list\./,
    );
    expect(table.stdout).toMatch(/Modal \(suggested\)/);
  });

  /** TEST_SCENARIO: a mistyped kit must fail loud with the kit's name and where to look, not show an empty kit (AC-3). */
  it("refuses an unknown kit, naming it and dam kit list", async () => {
    const r = await dam("kit", "show", "reserch");
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("no starter kit `reserch`");
    expect(r.stderr).toContain("dam kit list");
  });

  /** TEST_SCENARIO: the agent creates from a kit as the modal would — the one matching connection the user owns is granted for a required need — and gets back the setup left as a list it can work through (AC-4). */
  it("creates an agent from a kit and lists the steps left", async () => {
    const r = await dam(
      "agent",
      "create",
      "desk",
      "--kit",
      "research",
      "--skip-schedule",
      "morning-brief",
      "--json",
    );
    expect(r.exitCode, r.stderr).toBe(0);
    expect(applied).toEqual([
      expect.objectContaining({
        catalog: "builtin",
        kitId: "research",
        name: "desk",
        connectionIds: ["conn-gh"],
        slackChannelIds: [],
        skipSchedules: ["morning-brief"],
      }),
    ]);
    const out = JSON.parse(r.stdout) as {
      agent: { name: string };
      kit: string;
      steps: { kind: string; what: string; done: boolean; command: string }[];
    };
    expect(out.agent.name).toBe("desk");
    expect(out.kit).toBe("research");
    expect(
      out.steps.map(({ kind, what, done }) => ({ kind, what, done })),
    ).toEqual([
      { kind: "connection", what: "GitHub", done: true },
      { kind: "connection", what: "Modal", done: false },
      { kind: "channel", what: "Slack channel", done: false },
      { kind: "onboarding", what: "the agent's first session", done: false },
    ]);
    expect(out.steps[2]!.command).toBe(
      "dam channel slack connect desk --channel-id <channel-id>",
    );
  });

  /** TEST_SCENARIO: a schedule the kit does not have is refused before anything is created, so a typo cannot leave an agent behind with the wrong schedules. */
  it("refuses a schedule the kit does not have, creating nothing", async () => {
    const r = await dam(
      "agent",
      "create",
      "desk",
      "--kit",
      "research",
      "--skip-schedule",
      "nightly",
    );
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("no schedule `nightly`");
    expect(applied).toEqual([]);
  });

  /** TEST_SCENARIO: the agent tells the user which kit an agent came from and that a newer version waits, and takes it as the web app's Update button does (AC-5). */
  it("shows the kit and its update on dam agent get, and dam kit update starts it", async () => {
    agents.push(
      agent({
        id: "agent-0000000000000042",
        name: "desk",
        starterKit: `builtin/research@${KIT_COMMIT}`,
      }),
    );
    updates = [
      {
        agentId: "agent-0000000000000042",
        state: "available",
        current: KIT_COMMIT,
        latest: LATEST_COMMIT,
        pending: null,
      },
    ];

    const got = await dam("agent", "get", "desk");
    expect(got.exitCode, got.stderr).toBe(0);
    expect(got.stdout).toMatch(
      /^STARTER KIT:\s+research \(builtin\/research@aaaaaaaaa\)$/m,
    );
    expect(got.stdout).toMatch(
      /^KIT UPDATE:\s+update available \(bbbbbbbbb\): `dam kit update desk`$/m,
    );
    const json = await dam("agent", "get", "desk", "--json");
    expect(JSON.parse(json.stdout)).toMatchObject({
      starterKit: `builtin/research@${KIT_COMMIT}`,
      kitUpdate: { state: "available", latest: LATEST_COMMIT },
    });

    const update = await dam("kit", "update", "desk");
    expect(update.exitCode, update.stderr).toBe(0);
    expect(started).toEqual(["agent-0000000000000042"]);
    expect(update.stdout).toContain("Started the kit update");

    const skip = await dam("kit", "skip", "desk");
    expect(skip.exitCode).toBe(2);
    expect(skip.stderr).toContain("no kit update to skip: up-to-date");
  });

  /** TEST_SCENARIO: a repository kit writes its own text; a printed command must stay one command when pasted, and an escape code must not rewrite the install line the user checks. */
  it("quotes kit text in printed commands and drops its control codes", async () => {
    inspected = { "https://github.com/acme/hostile": HOSTILE };
    const r = await dam("kit", "show", "https://github.com/acme/hostile");
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).toContain(
      "dam connection connect 'x;touch /tmp/p;', then",
    );
    expect(r.stdout).toContain("--skip-schedule 'a>b'");
    expect(r.stdout).not.toContain(ESC);
    expect(r.stdout).not.toContain("\r");
    expect(r.stdout).toContain(`--commit ${KIT_COMMIT}`);

    const json = await dam(
      "kit",
      "show",
      "https://github.com/acme/hostile",
      "--json",
    );
    expect(JSON.parse(json.stdout).kit.name).toBe(HOSTILE.name);
  });

  /** TEST_SCENARIO: a repository kit is created only from the commit the user checked, so a push between show and create cannot slip in an install command nobody read. */
  it("creates a repository kit only at the commit given with --commit", async () => {
    inspected = { "https://github.com/acme/desk": LINKED };
    const url = "https://github.com/acme/desk";

    const none = await dam("agent", "create", "desk", "--kit", url);
    expect(none.exitCode).toBe(2);
    expect(none.stderr).toContain("needs --commit <sha>");

    const moved = await dam(
      "agent",
      "create",
      "desk",
      "--kit",
      url,
      "--commit",
      LATEST_COMMIT,
    );
    expect(moved.exitCode).toBe(2);
    expect(moved.stderr).toContain(`is at ${KIT_COMMIT} now`);
    expect(applied).toEqual([]);

    const ok = await dam(
      "agent",
      "create",
      "desk",
      "--kit",
      url,
      "--commit",
      KIT_COMMIT,
    );
    expect(ok.exitCode, ok.stderr).toBe(0);
    expect(applied).toEqual([
      expect.objectContaining({
        catalog: "link",
        link: { url, commit: KIT_COMMIT },
      }),
    ]);

    const catalog = await dam(
      "agent",
      "create",
      "other",
      "--kit",
      "plain",
      "--commit",
      KIT_COMMIT,
    );
    expect(catalog.exitCode).toBe(2);
    expect(catalog.stderr).toContain(
      "--commit only goes with a kit from a repository",
    );
  });

  /** TEST_SCENARIO: with no right to read connections the CLI cannot tell whether a granted id meets a need; saying "not done" would send the agent after a second secret. */
  it("leaves connection steps unchecked when connections cannot be read", async () => {
    scopes = ALL_SCOPES.filter((s) => !s.startsWith("credentials:"));
    const r = await dam(
      "agent",
      "create",
      "desk",
      "--kit",
      "research",
      "--connection",
      "conn-gh",
      "--json",
    );
    expect(r.exitCode, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout) as {
      steps: { kind: string; done: boolean | null; note?: string }[];
    };
    expect(
      out.steps.filter((s) => s.kind === "connection").map((s) => s.done),
    ).toEqual([null, null]);
    expect(out.steps[0]!.note).toContain("needs credentials:read");
  });
});
