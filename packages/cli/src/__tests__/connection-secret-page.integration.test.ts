import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import {
  ALL_SCOPES,
  type ApiContext,
  type ConnectionCreateInput,
  type ConnectionRequestSecretInput,
  type ConnectionTemplateView,
  type ConnectionView,
  type CredentialCheck,
  type SecretRequestState,
  type UserIdentity,
} from "api-server-api";
import { appRouter } from "api-server-api/router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDam } from "./run-dam.js";

/**
 * TEST_OVERVIEW: the user's agent runs `dam connection connect` and
 * `dam connection update` itself, without the secret and without a terminal.
 * The CLI asks the server for a secret-entry link, prints or opens it, waits
 * while the user enters the secret on the web page, and reports the result
 * with the exit code and `--json`, as it does for OAuth. The secret never
 * passes through the CLI. The result of the token check comes back with it,
 * so an agent never calls a connection ready when its token failed the check,
 * and `dam connection test` checks a stored token again.
 */

const FIXTURE_USER: UserIdentity = {
  sub: "fixture-user",
  preferredUsername: "fixture-user",
  scopes: ALL_SCOPES,
  agentIds: "*",
};

const GITHUB_PAT: ConnectionTemplateView = {
  id: "github-pat",
  name: "GitHub (Personal Access Token)",
  category: "app",
  isCustom: false,
  authKind: "header",
  inputs: [
    { name: "host", state: "overridable", presetValue: "api.github.com" },
    { name: "headerName", state: "overridable", presetValue: "Authorization" },
    {
      name: "valueFormat",
      state: "overridable",
      presetValue: "Bearer {value}",
    },
    { name: "value", state: "required", secret: true },
  ],
};

const EXISTING: ConnectionView = {
  id: "conn-000000000042",
  ownerId: "fixture-user",
  templateId: "github-pat",
  category: "app",
  name: "my-github",
  status: "active",
  authKind: "header",
  contributions: [],
  hosts: ["api.github.com"],
};

interface Fixture {
  url: string;
  requests: ConnectionRequestSecretInput[];
  creates: ConnectionCreateInput[];
  close: () => Promise<void>;
}

const FAILED: CredentialCheck = {
  status: "failed",
  reason: "GitHub refused the token (Bad credentials)",
  at: "2026-10-22T08:00:00.000Z",
};

const PASSED: CredentialCheck = {
  status: "passed",
  account: "octocat",
  expiresAt: "2026-11-21T10:00:00.000Z",
  at: "2026-10-22T08:00:00.000Z",
};

async function startFixture(
  states: SecretRequestState[],
  opts: {
    noSecretPage?: boolean;
    check?: CredentialCheck | null;
  } = {},
): Promise<Fixture> {
  const requests: ConnectionRequestSecretInput[] = [];
  const creates: ConnectionCreateInput[] = [];
  let polls = 0;
  const connections = {
    listTemplates: async () => [GITHUB_PAT],
    listAndReconcileConnections: async () => [EXISTING],
    createFromTemplate: async (input: ConnectionCreateInput) => {
      creates.push(input);
      return "conn-000000000099";
    },
    getConnection: async (id: string) => ({
      ...EXISTING,
      id,
      ...(opts.check ? { check: opts.check } : {}),
    }),
    checkCredential: async () => opts.check ?? null,
  };
  const secretRequests = {
    request: async (input: ConnectionRequestSecretInput) => {
      if (opts.noSecretPage) throw new Error("not reached");
      requests.push(input);
      return {
        requestId: "req-1",
        url: "https://dam.example.com/connections/secret?request=req-1",
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      };
    },
    status: async () => states[Math.min(polls++, states.length - 1)]!,
  };
  const terms = { isAccepted: async () => true };
  const ctx = new Proxy(
    { connections, secretRequests, terms, user: FIXTURE_USER } as Record<
      string,
      unknown
    >,
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
      if (opts.noSecretPage && req.url.includes("requestSecret")) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: {
              message: 'No procedure found on path "connections.requestSecret"',
              code: -32004,
              data: { code: "NOT_FOUND", httpStatus: 404 },
            },
          }),
        );
        return;
      }
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const fetchRes = await fetchRequestHandler({
        endpoint: "/api/trpc",
        req: new Request(`http://localhost${req.url}`, {
          method: req.method!,
          headers: Object.fromEntries(
            Object.entries(req.headers).filter(
              (e): e is [string, string] => typeof e[1] === "string",
            ),
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
  if (typeof addr !== "object" || addr === null) throw new Error("no port");
  return {
    url: `http://127.0.0.1:${addr.port}`,
    requests,
    creates,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

describe("connection secrets entered on the web page (integration)", () => {
  let home: string;
  let fixture: Fixture | undefined;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "dam-secret-page-"));
  });

  afterEach(async () => {
    await fixture?.close();
    fixture = undefined;
    await rm(home, { recursive: true, force: true });
  });

  async function dam(args: string[]) {
    const dir = join(home, ".config", "dam");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "config.toml"), `server = "${fixture!.url}"\n`);
    return runDam(args, {
      HOME: home,
      PATH: process.env.PATH ?? "",
      DAM_TOKEN: "test-token",
    });
  }

  // TEST_SCENARIO: an agent connects a PAT without the token and without a terminal: the CLI sends every other input to the server, prints the link, waits for the save and prints the new id as JSON, and never creates the connection itself.
  it("connect waits for the secret entered on the page", async () => {
    fixture = await startFixture([
      { status: "pending" },
      { status: "saved", connectionId: "conn-000000000007" },
    ]);
    const r = await dam([
      "connection",
      "connect",
      "github-pat",
      "--name",
      "work-github",
      "--no-browser",
      "--json",
    ]);
    expect(r.exitCode, `stderr: ${r.stderr}`).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({
      ok: true,
      id: "conn-000000000007",
      status: "active",
      authKind: "header",
    });
    expect(r.stderr).toContain(
      "https://dam.example.com/connections/secret?request=req-1",
    );
    expect(fixture.requests).toEqual([
      {
        action: "create",
        connection: {
          templateId: "github-pat",
          name: "work-github",
          authKind: "header",
        },
      },
    ]);
    expect(fixture.creates).toEqual([]);
  });

  // TEST_SCENARIO: the user saved a token that failed the check anyway; connect still exits 0, since the connection exists, but --json carries the failed check and the human output warns, so the agent does not tell the user it is ready.
  it("connect reports a token saved after a failed check", async () => {
    fixture = await startFixture([
      { status: "saved", connectionId: "conn-000000000007", check: FAILED },
    ]);
    const json = await dam([
      "connection",
      "connect",
      "github-pat",
      "--no-browser",
      "--json",
    ]);
    expect(json.exitCode, `stderr: ${json.stderr}`).toBe(0);
    expect(JSON.parse(json.stdout)).toMatchObject({
      ok: true,
      id: "conn-000000000007",
      check: FAILED,
    });

    fixture.requests.length = 0;
    const human = await dam([
      "connection",
      "connect",
      "github-pat",
      "--name",
      "work-github",
      "--no-browser",
    ]);
    expect(human.stderr).toContain(
      "warning: work-github failed its check: GitHub refused the token (Bad credentials)",
    );
    expect(human.stderr).toContain("dam connection update work-github");
  });

  // TEST_SCENARIO: a token passed as a flag is checked by the server the same way, and connect reports the account the check found.
  it("connect names the account of a checked token", async () => {
    fixture = await startFixture([], { check: PASSED });
    const r = await dam([
      "connection",
      "connect",
      "github-pat",
      "--name",
      "work-github",
      "--value",
      "ghp_flag",
    ]);
    expect(r.exitCode, `stderr: ${r.stderr}`).toBe(0);
    expect(r.stdout).toBe(
      "✓ Created work-github (conn-000000000099) as octocat\n",
    );
  });

  // TEST_SCENARIO: a rotation without the new value asks the server for a link for that connection and reports the update once the user saved it.
  it("update waits for the secret entered on the page", async () => {
    fixture = await startFixture([
      { status: "saved", connectionId: EXISTING.id },
    ]);
    const r = await dam([
      "connection",
      "update",
      "my-github",
      "--no-browser",
      "--json",
    ]);
    expect(r.exitCode, `stderr: ${r.stderr}`).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({
      ok: true,
      id: EXISTING.id,
      name: "my-github",
    });
    expect(fixture.requests).toEqual([
      { action: "update", connectionId: EXISTING.id },
    ]);
  });

  // TEST_SCENARIO: a rotation the user saved after a failed check reports the check under --json, as connect does.
  it("update reports the check of the new token", async () => {
    fixture = await startFixture([
      { status: "saved", connectionId: EXISTING.id, check: FAILED },
    ]);
    const r = await dam([
      "connection",
      "update",
      "my-github",
      "--no-browser",
      "--json",
    ]);
    expect(r.exitCode, `stderr: ${r.stderr}`).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({
      ok: true,
      id: EXISTING.id,
      name: "my-github",
      check: FAILED,
    });
  });

  // TEST_SCENARIO: the user cancels on the page, or lets the link expire, and the agent learns it from a failing exit code instead of waiting forever.
  it.each([
    ["cancelled", /page was cancelled/],
    ["expired", /link expired/],
  ] as const)("fails when the request is %s", async (status, message) => {
    fixture = await startFixture([{ status }]);
    const r = await dam([
      "connection",
      "connect",
      "github-pat",
      "--no-browser",
    ]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(message);
    expect(fixture.creates).toEqual([]);
  });

  // TEST_SCENARIO: --prompt keeps the hidden terminal prompt; without a terminal it names the flag to pass, and says how to use the page instead.
  it("--prompt without a terminal names the missing flag", async () => {
    fixture = await startFixture([{ status: "pending" }]);
    const r = await dam(["connection", "connect", "github-pat", "--prompt"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("missing required input(s): --value");
    expect(r.stderr).toContain("drop --prompt");
    expect(fixture.requests).toEqual([]);
  });

  // TEST_SCENARIO: a server from before the page has no requestSecret procedure; the CLI falls back to the terminal prompt, so a newer CLI does not break against it.
  it("falls back to the prompt on a server without the page", async () => {
    fixture = await startFixture([], { noSecretPage: true });
    const r = await dam([
      "connection",
      "connect",
      "github-pat",
      "--no-browser",
    ]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("no secret-entry page");
    expect(r.stderr).toContain("missing required input(s): --value");
  });

  // TEST_SCENARIO: a secret passed as a flag still creates the connection directly, with no page.
  it("creates directly when the secret is passed", async () => {
    fixture = await startFixture([]);
    const r = await dam([
      "connection",
      "connect",
      "github-pat",
      "--value",
      "ghp_flag",
      "--json",
    ]);
    expect(r.exitCode, `stderr: ${r.stderr}`).toBe(0);
    expect(fixture.requests).toEqual([]);
    expect(fixture.creates).toEqual([
      expect.objectContaining({ templateId: "github-pat", value: "ghp_flag" }),
    ]);
  });

  // TEST_SCENARIO: an agent whose GitHub calls fail checks the stored token again; a failed check exits 1 with the reason in --json, so the agent can tell the token is the cause.
  it("test checks a stored token again", async () => {
    fixture = await startFixture([], { check: FAILED });
    const failed = await dam(["connection", "test", "my-github", "--json"]);
    expect(failed.exitCode).toBe(1);
    expect(JSON.parse(failed.stdout)).toEqual({
      id: EXISTING.id,
      name: "my-github",
      check: FAILED,
    });
    await fixture.close();

    fixture = await startFixture([], { check: PASSED });
    const passed = await dam(["connection", "test", "my-github"]);
    expect(passed.exitCode, `stderr: ${passed.stderr}`).toBe(0);
    expect(passed.stdout).toBe(
      `my-github (${EXISTING.id}): passed (as octocat; expires 2026-11-21)\n`,
    );
  });

  // TEST_SCENARIO: a connection whose template names no check says so and exits 2, rather than reporting a pass.
  it("test refuses a connection with no check", async () => {
    fixture = await startFixture([], { check: null });
    const r = await dam(["connection", "test", "my-github"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("has no credential check");
  });
});
