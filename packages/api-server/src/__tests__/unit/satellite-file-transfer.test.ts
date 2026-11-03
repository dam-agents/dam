import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SATELLITE_TRANSFER_CLAIM_HEADER,
  type SatelliteTool,
  type UserIdentity,
} from "api-server-api";
import { configureLogger } from "../../core/logger.js";
import type { ApiVariables } from "../../core/http-context.js";
import { transferTokenHash } from "../../modules/satellites/domain/transfer-token.js";
import type { JobRow } from "../../modules/satellites/domain/types.js";
import type { AgentTransfer } from "../../modules/satellites/infrastructure/agent-transfer.js";
import type { SatellitesRepository } from "../../modules/satellites/infrastructure/satellites-repository.js";
import { createSatelliteFileRoutes } from "../../modules/satellites/routes/file-transfer.js";

/**
 * TEST_OVERVIEW: One file crossing between a machine and an Agent's workspace,
 * on its own request rather than in a Job's result. A request authorises
 * nothing by naming a Job: it must present the token that Job's claim was
 * issued, and the direction and both paths come from the Job's own arguments —
 * what the Agent asked for, never what the machine says. The token is spent by
 * one atomic statement, which is also the check that the Job is still running,
 * so nothing lands or leaves after the Job ends.
 *
 * The specs pin each of those: a wrong direction, a forged or spent claim, a
 * path the Agent did not ask for, a Job that settles while the bytes are in
 * flight, a body over the cap, and the audit line that records a transfer
 * without ever recording a byte of it.
 */

const TOKEN = "a".repeat(64);
const OTHER_TOKEN = "b".repeat(64);
const SECRET_MARKER = "PRIVATE-MARKER-9f3a";

const sha256 = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");

const SERVE_KEY: UserIdentity = {
  sub: "owner-1",
  preferredUsername: "owner",
  scopes: ["satellites:serve"],
  agentIds: "*",
};

const TOOLS: SatelliteTool[] = [
  {
    name: "download",
    inputSchema: { type: "object" },
    transfer: "download",
  },
  { name: "upload", inputSchema: { type: "object" }, transfer: "upload" },
  { name: "run", inputSchema: { type: "object" } },
];

function job(overrides: Partial<JobRow> = {}): JobRow {
  return {
    owner: "owner-1",
    satellite: "laptop",
    sequence: 7,
    agentId: "agent-1",
    tool: "download",
    args: { path: "logs/app.log" },
    status: "running",
    isError: false,
    exitCode: null,
    output: null,
    images: [],
    truncated: false,
    reason: null,
    cancelRequested: false,
    cancelSentAt: null,
    deliveredAt: null,
    wokeAt: null,
    awaitedUntil: null,
    startedAt: new Date(),
    endedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

interface Harness {
  app: Hono<{ Variables: ApiVariables }>;
  repo: SatellitesRepository;
  state: { job: JobRow; hash: string | null; spent: number };
  staged: { ok: boolean }[];
  published: { id: string; path: string }[];
  read: string[];
  publishedPath: string;
}

function setup(
  options: {
    job?: JobRow;
    hash?: string | null;
    user?: UserIdentity;
    cap?: number;
    reCheckMs?: number;
    onStage?: () => void;
    readFail?: "not-found" | "too-large" | "refused";
    readBytes?: Buffer;
    readDeferred?: { release: () => void };
  } = {},
): Harness {
  const state = {
    job: options.job ?? job(),
    hash: options.hash === undefined ? transferTokenHash(TOKEN) : options.hash,
    spent: 0,
  };
  const staged: { ok: boolean }[] = [];
  const published: { id: string; path: string }[] = [];
  const read: string[] = [];

  const repo = {
    getJob: async () => state.job,
    get: async () => ({
      owner: "owner-1",
      name: "laptop",
      description: null,
      host: null,
      maxConcurrent: 4,
      tools: TOOLS,
      draining: false,
      lastSeenAt: new Date(),
    }),
    transferTokenHashOf: async () => state.hash,
    consumeTransfer: async (
      _owner: string,
      _satellite: string,
      _sequence: number,
      token: string,
    ) => {
      if (state.job.status !== "running") return null;
      if (state.hash === null || state.hash !== transferTokenHash(token))
        return null;
      state.hash = null;
      state.spent += 1;
      return state.job;
    },
  } as unknown as SatellitesRepository;

  const transfer: AgentTransfer = {
    async stage(body) {
      options.onStage?.();
      try {
        for await (const chunk of body) void chunk;
      } catch {
        staged.push({ ok: false });
        return { ok: false, reason: "aborted" };
      }
      staged.push({ ok: true });
      return { ok: true, id: "c".repeat(32) };
    },
    async publish(input) {
      published.push(input);
      return { ok: true, path: `/home/agent/${input.path}` };
    },
    async read(path) {
      read.push(path);
      if (options.readFail !== undefined)
        return { ok: false, reason: options.readFail };
      const bytes = options.readBytes ?? Buffer.from("from the workspace");
      const stream = Readable.from([bytes]);
      if (options.readDeferred !== undefined) {
        const gate = new Promise<void>((settle) => {
          options.readDeferred!.release = settle;
        });
        const deferred = new Readable({ read() {} });
        void gate.then(() => {
          deferred.push(bytes);
          deferred.push(null);
        });
        return { ok: true, size: bytes.length, stream: deferred };
      }
      return { ok: true, size: bytes.length, stream };
    },
  };

  const app = new Hono<{ Variables: ApiVariables }>();
  app.use("*", async (c, next) => {
    c.set("user", options.user ?? SERVE_KEY);
    c.set("roles", []);
    c.set("surface", "api");
    await next();
  });
  app.route(
    "/",
    createSatelliteFileRoutes({
      repo,
      transferFor: () => transfer,
      ...(options.cap === undefined ? {} : { cap: options.cap }),
      ...(options.reCheckMs === undefined
        ? {}
        : { reCheckMs: options.reCheckMs }),
    }),
  );
  return {
    app,
    repo,
    state,
    staged,
    published,
    read,
    publishedPath: `/home/agent/.dam/satellite-files/laptop-7-${TOKEN.slice(0, 8)}/app.log`,
  };
}

function transferRequest(
  app: Hono<{ Variables: ApiVariables }>,
  options: {
    method?: "POST" | "GET";
    token?: string | null;
    body?: Buffer;
    name?: string;
    sequence?: number;
  } = {},
): Promise<Response> {
  const token = options.token === undefined ? TOKEN : options.token;
  const init: RequestInit = {
    method: options.method ?? "POST",
    headers: token === null ? {} : { [SATELLITE_TRANSFER_CLAIM_HEADER]: token },
    ...(options.method === "GET"
      ? {}
      : { body: new Uint8Array(options.body ?? Buffer.from("line one\n")) }),
  };
  return Promise.resolve(
    app.request(
      `/api/satellites/${options.name ?? "laptop"}/jobs/${options.sequence ?? 7}/file`,
      init,
    ),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  configureLogger({ level: "info" });
});

describe("a file the machine sends into the agent's workspace", () => {
  it("lands where the platform decides, once, and reports path, size and sha256", async () => {
    const harness = setup();
    const body = Buffer.from("line one\n");

    const res = await transferRequest(harness.app, { body });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      path: harness.publishedPath,
      size: body.length,
      sha256: sha256(body),
    });
    expect(harness.published).toEqual([
      {
        id: "c".repeat(32),
        path: `.dam/satellite-files/laptop-7-${TOKEN.slice(0, 8)}/app.log`,
      },
    ]);
    expect(harness.state.spent).toBe(1);
  });

  it("refuses a job whose tool moves files the other way, or not at all", async () => {
    for (const tool of ["upload", "run"]) {
      const harness = setup({ job: job({ tool }) });
      const res = await transferRequest(harness.app);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "wrong_direction" });
      expect(harness.staged).toHaveLength(0);
    }
  });

  it("refuses a request without the claim's token, or with another one", async () => {
    for (const [token, status] of [
      [null, 400],
      ["not-a-token", 400],
      [OTHER_TOKEN, 403],
    ] as const) {
      const harness = setup();
      const res = await transferRequest(harness.app, { token });
      expect(res.status).toBe(status);
      expect(harness.published).toHaveLength(0);
    }
    const spent = setup({ hash: null });
    expect((await transferRequest(spent.app)).status).toBe(403);
    expect(spent.published).toHaveLength(0);
  });

  it("refuses a key that is not a serve key, or that is bound to one agent", async () => {
    for (const user of [
      { ...SERVE_KEY, scopes: ["agents:operate"] },
      { ...SERVE_KEY, agentIds: ["agent-1"] },
    ] as UserIdentity[]) {
      const harness = setup({ user });
      expect((await transferRequest(harness.app)).status).toBe(403);
      expect(harness.published).toHaveLength(0);
    }
  });

  it("lands nothing when the job ends while the bytes are in flight", async () => {
    const harness = setup({
      onStage: () => {
        harness.state.job = { ...harness.state.job, status: "done" };
      },
    });
    const res = await transferRequest(harness.app);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "no_running_job" });
    expect(harness.published).toHaveLength(0);
  });

  it("refuses a job that has already settled, before it stages anything", async () => {
    const harness = setup({ job: job({ status: "done" }) });
    expect((await transferRequest(harness.app)).status).toBe(409);
    expect(harness.staged).toHaveLength(0);
  });

  it("cuts a body over the cap off instead of taking it", async () => {
    const harness = setup({ cap: 8 });
    const res = await transferRequest(harness.app, {
      body: Buffer.alloc(64, 1),
    });
    expect(res.status).toBe(413);
    expect(harness.published).toHaveLength(0);
    expect(harness.state.spent).toBe(0);
  });

  /**
   * TEST_SCENARIO: The workspace end can fail for reasons of its own, and its
   * error text is not ours to trust: it is never logged and never reaches the
   * machine. What comes back is a code this route chose, and the audit line
   * carries only metadata.
   */
  it("turns a workspace failure into a code, logging neither its text nor a byte", async () => {
    const lines: string[] = [];
    configureLogger({ level: "info", write: (line) => lines.push(line) });
    const harness = setup();
    const agent = {
      async stage() {
        throw new Error(`the device said ${SECRET_MARKER}`);
      },
      async publish() {
        throw new Error(`the device said ${SECRET_MARKER}`);
      },
      async read() {
        throw new Error(`the device said ${SECRET_MARKER}`);
      },
    };
    const app = new Hono<{ Variables: ApiVariables }>();
    app.use("*", async (c, next) => {
      c.set("user", SERVE_KEY);
      c.set("roles", []);
      c.set("surface", "api");
      await next();
    });
    app.route(
      "/",
      createSatelliteFileRoutes({
        repo: harness.repo,
        transferFor: () => agent,
      }),
    );

    const res = await transferRequest(app);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "workspace_refused" });
    expect(lines.join("\n")).not.toContain(SECRET_MARKER);
  });

  it("refuses a source path with no usable file name", async () => {
    const harness = setup({ job: job({ args: { path: "" } }) });
    expect((await transferRequest(harness.app)).status).toBe(400);
    expect(harness.published).toHaveLength(0);
  });

  it("records the transfer and never a byte of it", async () => {
    const lines: string[] = [];
    configureLogger({ level: "info", write: (line) => lines.push(line) });
    const harness = setup();
    await transferRequest(harness.app, {
      body: Buffer.from(`${SECRET_MARKER}\n`),
    });

    expect(lines.length).toBeGreaterThan(0);
    const transferLines = lines.filter((line) =>
      line.includes("satellites.transfer"),
    );
    expect(transferLines).toHaveLength(2);
    const written = transferLines.find((line) => line.includes("written"));
    expect(written).toBeDefined();
    expect(JSON.parse(written!)).toMatchObject({
      direction: "download",
      satellite: "laptop",
      sequence: 7,
      agentId: "agent-1",
      path: harness.publishedPath,
      bytes: SECRET_MARKER.length + 1,
      outcome: "written",
    });
    expect(lines.join("\n")).not.toContain(SECRET_MARKER);
  });
});

describe("a file the machine asks the agent's workspace for", () => {
  it("sends the workspace file the agent asked for, and its bytes", async () => {
    const bytes = Buffer.from("from the workspace");
    const harness = setup({
      job: job({
        tool: "upload",
        args: { path: "inbox/x", workspacePath: "work/report.csv" },
      }),
      readBytes: bytes,
    });

    const res = await transferRequest(harness.app, { method: "GET" });

    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe(
      "from the workspace",
    );
    expect(harness.read).toEqual(["work/report.csv"]);
    expect(harness.state.spent).toBe(1);
  });

  it("refuses a download job asking for a file", async () => {
    const harness = setup();
    expect((await transferRequest(harness.app, { method: "GET" })).status).toBe(
      403,
    );
    expect(harness.read).toHaveLength(0);
  });

  it("refuses a workspace path the platform will not resolve", async () => {
    const harness = setup({
      job: job({
        tool: "upload",
        args: { path: "x", workspacePath: "../etc/passwd" },
      }),
    });
    expect((await transferRequest(harness.app, { method: "GET" })).status).toBe(
      400,
    );
    expect(harness.read).toHaveLength(0);
  });

  it("maps the workspace's own refusals", async () => {
    for (const [reason, status] of [
      ["not-found", 404],
      ["too-large", 413],
      ["refused", 409],
    ] as const) {
      const harness = setup({
        job: job({
          tool: "upload",
          args: { path: "x", workspacePath: "work/a" },
        }),
        readFail: reason,
      });
      expect(
        (await transferRequest(harness.app, { method: "GET" })).status,
      ).toBe(status);
    }
  });

  it("stops sending when the job ends mid-read", async () => {
    const deferred = { release: () => {} };
    const harness = setup({
      job: job({
        tool: "upload",
        args: { path: "x", workspacePath: "work/a" },
      }),
      readDeferred: deferred,
      reCheckMs: 10,
    });
    const res = await transferRequest(harness.app, { method: "GET" });
    expect(res.status).toBe(200);

    harness.state.job = { ...harness.state.job, status: "cancelled" };
    await new Promise((resolve) => setTimeout(resolve, 40));

    await expect(res.arrayBuffer()).rejects.toThrow();
  });
});
