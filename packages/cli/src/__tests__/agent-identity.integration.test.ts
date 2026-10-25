// TEST_OVERVIEW: An agent driving DAM changes from the CLI what the web app's avatar picker and name field change. `dam agent update --name` renames through agents.update with the server's name rules. `--avatar` takes a character the user unlocked, or one emoji when the custom avatars feature is on; `--avatar-file` uploads the image through POST /api/avatars, as the picker does, and stores the server's answer; `--avatar-default` sends null, so the agent shows its default character again. `dam agent create` takes the same flags, `dam agent get` shows the avatar, and `dam agent avatars` lists the characters, which are unlocked, and whether custom avatars are on.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { TRPCError } from "@trpc/server";
import { appRouter } from "api-server-api/router";
import {
  ALL_SCOPES,
  type Agent,
  type AgentCreateInput,
  type AgentUpdateInput,
  type ApiContext,
} from "api-server-api";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDam } from "./run-dam.js";
import { ownedAgents } from "./owned-agents.js";

const AGENT_ID = "agent-0000000000000001";
const IMAGE_ID = "a".repeat(64);

describe("dam agent identity: name and avatar (integration)", () => {
  let home: string;
  let server: Server;
  let host: string;
  let stored: { name: string; avatar?: string };
  let updates: AgentUpdateInput[];
  let creates: AgentCreateInput[];
  let uploads: { contentType: string | undefined; bytes: number }[];
  let uploadAnswer: { status: number; body: object };
  let unlocked: string[];
  let customAvatars: boolean;

  function agent(): Agent {
    return {
      id: AGENT_ID,
      name: stored.name,
      templateId: "default",
      spec: {
        name: stored.name,
        image: "",
        ...(stored.avatar && { avatar: stored.avatar }),
      },
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
    };
  }

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "dam-agent-identity-"));
    stored = { name: "demo" };
    updates = [];
    creates = [];
    uploads = [];
    uploadAnswer = { status: 200, body: { avatar: `image:${IMAGE_ID}` } };
    unlocked = ["lens", "compass"];
    customAvatars = false;

    const apiContext = {
      user: { sub: "fixture-user", scopes: ALL_SCOPES, agentIds: "*" },
      actOnAgent: async () => ({ ok: true, ctx: apiContext }),
      terms: { isAccepted: async () => true },
      invocationsQuery: { listTargets: async () => [] },
      agents: ownedAgents({
        get: async () => agent(),
        list: async () => [agent()],
        create: async (input: AgentCreateInput) => {
          creates.push(input);
          stored = {
            name: input.name,
            ...(input.avatar && { avatar: input.avatar }),
          };
          return agent();
        },
        update: async (input: AgentUpdateInput) => {
          updates.push(input);
          if (input.name === "taken")
            throw new TRPCError({
              code: "CONFLICT",
              message: 'you already have an agent named "taken"',
            });
          if (input.name !== undefined) stored.name = input.name;
          if (input.avatar === null) delete stored.avatar;
          else if (input.avatar !== undefined) stored.avatar = input.avatar;
          return agent();
        },
      }),
      templates: {
        list: async () => [
          { id: "default", name: "Default", spec: { image: "agent:latest" } },
        ],
      },
      gettingStarted: {
        progress: async () => ({
          dismissed: false,
          unlocks: unlocked.map((character) => ({
            task: "create-agent",
            character,
            unlockedAt: new Date(0).toISOString(),
            seen: true,
            fresh: false,
          })),
        }),
      },
      features: {
        flags: async () => ({ "custom-avatars": customAvatars }),
      },
      connections: {
        listAndReconcileConnections: async () => [],
        getAgentConnections: async (agentId: string) => ({
          agentId,
          connections: [],
        }),
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
          ],
        }),
        sessionDefaults: async () => ({
          chat: null,
          channel: null,
          scheduled: null,
        }),
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
      if (req.url === "/api/avatars" && req.method === "POST") {
        uploads.push({
          contentType: req.headers["content-type"],
          bytes: body.length,
        });
        res.writeHead(uploadAnswer.status, {
          "Content-Type": "application/json",
        });
        res.end(JSON.stringify(uploadAnswer.body));
        return;
      }
      const response = await fetchRequestHandler({
        endpoint: "/api/trpc",
        req: new Request(`http://localhost${req.url}`, {
          method: req.method!,
          headers: { "content-type": "application/json" },
          body: body.length > 0 ? body : undefined,
        }),
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
   * TEST_SCENARIO: a user asks their agent to rename a DAM agent and give it
   * another character; one update does both, and the answer shows them.
   */
  it("agent update --name --avatar renames and picks an unlocked character", async () => {
    const r = await dam(
      "agent",
      "update",
      AGENT_ID,
      "--name",
      "release-helper",
      "--avatar",
      "compass",
    );
    expect(r.exitCode, r.stderr).toBe(0);
    expect(updates).toEqual([
      { id: AGENT_ID, name: "release-helper", avatar: "compass" },
    ]);
    expect(r.stdout).toMatch(/^NAME:\s+release-helper$/m);
    expect(r.stdout).toMatch(/^AVATAR:\s+compass$/m);
  });

  /**
   * TEST_SCENARIO: the picker offers only the characters the Getting Started
   * Checklist unlocked, so the CLI refuses a locked one before it changes
   * anything, and says how to unlock it.
   */
  it("agent update --avatar refuses a locked character", async () => {
    const r = await dam("agent", "update", AGENT_ID, "--avatar", "spark");
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("the `spark` avatar is still locked");
    expect(updates).toEqual([]);
  });

  /**
   * TEST_SCENARIO: an emoji is a custom avatar; it needs the feature on, is
   * accepted bare, and is stored as `emoji:<emoji>`. A value that is neither
   * a character nor one emoji is invalid input.
   */
  it("agent update --avatar takes one emoji when custom avatars are on", async () => {
    const off = await dam("agent", "update", AGENT_ID, "--avatar", "🦊");
    expect(off.exitCode).toBe(2);
    expect(off.stderr).toContain("needs the custom avatars feature");

    customAvatars = true;
    const on = await dam("agent", "update", AGENT_ID, "--avatar", "🦊");
    expect(on.exitCode, on.stderr).toBe(0);
    expect(updates).toEqual([{ id: AGENT_ID, avatar: "emoji:🦊" }]);

    const bad = await dam("agent", "update", AGENT_ID, "--avatar", "dragon");
    expect(bad.exitCode).toBe(2);
    expect(bad.stderr).toContain("unknown avatar `dragon`");
    expect(updates).toHaveLength(1);
  });

  /**
   * TEST_SCENARIO: an image goes through the same endpoint as the web app's
   * upload, as the file's bytes with its type, and the agent gets the
   * `image:<id>` the server answers.
   */
  it("agent update --avatar-file uploads the image and sets it", async () => {
    customAvatars = true;
    const file = join(home, "logo.png");
    await writeFile(file, Buffer.alloc(1234));
    const r = await dam(
      "agent",
      "update",
      AGENT_ID,
      "--avatar-file",
      file,
      "--json",
    );
    expect(r.exitCode, r.stderr).toBe(0);
    expect(uploads).toEqual([{ contentType: "image/png", bytes: 1234 }]);
    expect(updates).toEqual([{ id: AGENT_ID, avatar: `image:${IMAGE_ID}` }]);
    expect(JSON.parse(r.stdout)).toMatchObject({
      harnesses: ["claude-code"],
      agent: { id: AGENT_ID, avatar: `image:${IMAGE_ID}` },
    });
  });

  /**
   * TEST_SCENARIO: the server owns the image rules; its refusal, such as a
   * file over 2 MB, reaches the user word for word and changes nothing.
   */
  it("agent update --avatar-file prints the server's refusal", async () => {
    customAvatars = true;
    uploadAnswer = {
      status: 413,
      body: { error: "image is larger than 2 MB" },
    };
    const file = join(home, "big.jpg");
    await writeFile(file, Buffer.alloc(10));
    const r = await dam("agent", "update", AGENT_ID, "--avatar-file", file);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("image is larger than 2 MB");
    expect(uploads[0]?.contentType).toBe("image/jpeg");
    expect(updates).toEqual([]);

    const missing = await dam(
      "agent",
      "update",
      AGENT_ID,
      "--avatar-file",
      join(home, "nope.png"),
    );
    expect(missing.exitCode).toBe(2);
    expect(missing.stderr).toContain("cannot read");
  });

  /**
   * TEST_SCENARIO: going back to the default avatar sends null, which the
   * server turns into no stored choice.
   */
  it("agent update --avatar-default clears the avatar", async () => {
    stored.avatar = "lens";
    const r = await dam("agent", "update", AGENT_ID, "--avatar-default");
    expect(r.exitCode, r.stderr).toBe(0);
    expect(updates).toEqual([{ id: AGENT_ID, avatar: null }]);
    expect(r.stdout).toMatch(/^AVATAR:\s+<default>$/m);
  });

  /**
   * TEST_SCENARIO: the name rules are the server's: a name in the shape of
   * an id is refused before the call, and a name the user already has comes
   * back as the server's conflict.
   */
  it("agent update --name keeps the server's name rules", async () => {
    const idShape = await dam(
      "agent",
      "update",
      AGENT_ID,
      "--name",
      "agent-0123456789abcdef",
    );
    expect(idShape.exitCode).toBe(2);
    expect(updates).toEqual([]);

    const taken = await dam("agent", "update", AGENT_ID, "--name", "taken");
    expect(taken.exitCode).toBe(2);
    expect(taken.stderr).toContain('you already have an agent named "taken"');
  });

  it("agent update refuses two avatar flags at once", async () => {
    const r = await dam(
      "agent",
      "update",
      AGENT_ID,
      "--avatar",
      "lens",
      "--avatar-default",
    );
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("pass one of --avatar, --avatar-file");
    expect(updates).toEqual([]);
  });

  /**
   * TEST_SCENARIO: a new agent can start with its avatar, so no second
   * command is needed.
   */
  it("agent create --avatar starts the agent with it", async () => {
    const r = await dam("agent", "create", "fresh", "--avatar", "lens");
    expect(r.exitCode, r.stderr).toBe(0);
    expect(creates[0]).toMatchObject({ name: "fresh", avatar: "lens" });
  });

  it("agent get shows the avatar, or the default", async () => {
    const none = await dam("agent", "get", AGENT_ID);
    expect(none.exitCode, none.stderr).toBe(0);
    expect(none.stdout).toMatch(/^AVATAR:\s+<default>$/m);

    stored.avatar = "emoji:🦊";
    const set = await dam("agent", "get", AGENT_ID);
    expect(set.stdout).toMatch(/^AVATAR:\s+emoji:🦊$/m);
  });

  /**
   * TEST_SCENARIO: before it picks an avatar, an agent checks which
   * characters it may pass and whether an emoji or an image is allowed.
   */
  it("agent avatars lists the characters and what is unlocked", async () => {
    const r = await dam("agent", "avatars");
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^CHARACTER\s+UNLOCKED$/m);
    expect(r.stdout).toMatch(/^compass\s+yes$/m);
    expect(r.stdout).toMatch(/^spark\s+no$/m);
    expect(r.stdout).toContain(
      "Custom avatars (an emoji or an uploaded image): off",
    );

    const json = await dam("agent", "avatars", "--json");
    const parsed = JSON.parse(json.stdout) as {
      characters: { name: string; unlocked: boolean }[];
      custom: boolean;
    };
    expect(parsed.custom).toBe(false);
    expect(parsed.characters).toHaveLength(8);
    expect(parsed.characters).toContainEqual({ name: "lens", unlocked: true });
  });
});
