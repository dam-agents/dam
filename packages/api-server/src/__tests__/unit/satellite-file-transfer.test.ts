import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SATELLITE_TRANSFER_CLAIM_HEADER,
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

function job(overrides: Partial<JobRow> = {}): JobRow {
  return {
    owner: "owner-1",
    satellite: "laptop",
    sequence: 7,
    agentId: "agent-1",
    tool: "download",
    args: { path: "logs/app.log" },
    transferDirection: "download",
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
    declaredSize?: number;
    readDeferred?: { release: () => void };
    onRead?: () => void;
    readStream?: Readable;
    onGetJob?: (call: number) => Promise<void>;
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

  let getJobCalls = 0;
  const repo = {
    getJob: async () => {
      const snapshot = state.job;
      getJobCalls += 1;
      await options.onGetJob?.(getJobCalls);
      return snapshot;
    },
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
    async stage({ body }) {
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
      options.onRead?.();
      if (options.readFail !== undefined)
        return { ok: false, reason: options.readFail };
      if (options.readStream !== undefined)
        return {
          ok: true,
          size: options.declaredSize ?? 0,
          stream: options.readStream,
        };
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
      return {
        ok: true,
        size: options.declaredSize ?? bytes.length,
        stream,
      };
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

  /**
   * TEST_SCENARIO: The direction is frozen on the Job when the Agent's call is
   * admitted, so a Satellite that registers its tool list again with the tool
   * pointing the other way cannot reinterpret the Job's own arguments: the row
   * the request is checked against is the one the Agent made.
   */
  it("refuses a job whose frozen direction is not this request's", async () => {
    for (const direction of ["upload", null] as const) {
      const harness = setup({ job: job({ transferDirection: direction }) });
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

  /**
   * TEST_SCENARIO: The body comes from the network, and it can fail in the
   * middle. The transfer must fail as a whole: nothing is published, no staging
   * answer is trusted, and the counter that carried the bytes is torn down with
   * the source rather than left open for the runtime to keep reading.
   */
  it("fails the transfer when the body errors mid-stream", async () => {
    const harness = setup();
    const failing = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(Buffer.from("half")));
        controller.error(new Error("the machine hung up"));
      },
    });
    const res = await harness.app.request(
      "/api/satellites/laptop/jobs/7/file",
      {
        method: "POST",
        headers: { [SATELLITE_TRANSFER_CLAIM_HEADER]: TOKEN },
        body: failing,
        duplex: "half",
      } as RequestInit & { duplex: "half" },
    );

    expect(res.status).toBe(409);
    expect(harness.published).toHaveLength(0);
    expect(harness.state.spent).toBe(0);
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
        transferDirection: "upload",
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
        transferDirection: "upload",
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
          transferDirection: "upload",
          args: { path: "x", workspacePath: "work/a" },
        }),
        readFail: reason,
      });
      expect(
        (await transferRequest(harness.app, { method: "GET" })).status,
      ).toBe(status);
    }
  });

  /**
   * TEST_SCENARIO: The read is a round trip to the workspace, and a Job can end
   * inside it. The bytes must not leave after that: the response is refused
   * before its first byte, not opened and then stopped.
   */
  it("delivers nothing when the job ends while the workspace read is open", async () => {
    const harness = setup({
      job: job({
        tool: "upload",
        transferDirection: "upload",
        args: { path: "x", workspacePath: "work/a" },
      }),
      onRead: () => {
        harness.state.job = { ...harness.state.job, status: "cancelled" };
      },
    });
    const res = await transferRequest(harness.app, { method: "GET" });
    expect(res.status).toBe(409);
    expect(await res.text()).not.toContain("from the workspace");
  });

  /**
   * TEST_SCENARIO: A Satellite's sequence numbers restart when it is registered
   * again, so a row at the same owner, Satellite and sequence can be a different
   * Job. A running successor must not keep the predecessor's stream open.
   */
  it("stops the stream when a successor job answers to the same reference", async () => {
    const stream = new Readable({ read() {} });
    const harness = setup({
      job: job({
        tool: "upload",
        transferDirection: "upload",
        args: { path: "x", workspacePath: "work/a" },
      }),
      readStream: stream,
      declaredSize: 0,
      reCheckMs: 5,
    });
    const res = await transferRequest(harness.app, { method: "GET" });
    expect(res.status).toBe(200);

    harness.state.job = {
      ...harness.state.job,
      agentId: "another-agent",
      createdAt: new Date(Date.now() + 60_000),
    };
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(stream.destroyed).toBe(true);
    await res.body?.cancel().catch(() => {});
  });

  /**
   * TEST_SCENARIO: A runtime that says a file is small and then sends more is
   * the same escape as one that says it is large: the platform counts the bytes
   * it relays and cuts the response off at the cap.
   */
  it("cuts a stream off at the cap even when the workspace understates its size", async () => {
    const harness = setup({
      job: job({
        tool: "upload",
        transferDirection: "upload",
        args: { path: "x", workspacePath: "work/a" },
      }),
      cap: 4,
      declaredSize: 2,
      readBytes: Buffer.from("12345678"),
    });
    const res = await transferRequest(harness.app, { method: "GET" });
    const body = await res.arrayBuffer().catch(() => new ArrayBuffer(0));
    expect(body.byteLength).toBeLessThanOrEqual(4);
  });

  it("refuses a workspace that declares more than the cap", async () => {
    const harness = setup({
      job: job({
        tool: "upload",
        transferDirection: "upload",
        args: { path: "x", workspacePath: "work/a" },
      }),
      cap: 4,
      declaredSize: 8,
      readBytes: Buffer.from("12345678"),
    });
    const res = await transferRequest(harness.app, { method: "GET" });
    expect(res.status).toBe(413);
  });

  /**
   * TEST_SCENARIO: The pre-delivery check is a database round trip, and a
   * watcher tick can land inside it: the tick revokes, the query then answers
   * with the snapshot it took before the Job ended, and if the revocation were
   * read before the awaited check the stream would be opened with no watcher
   * left — delivering the whole file after the Job ended.
   */
  it("delivers nothing when the job ends while the pre-delivery check is in flight", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let reached!: () => void;
    const atCheck = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const harness = setup({
      job: job({
        tool: "upload",
        transferDirection: "upload",
        args: { path: "x", workspacePath: "work/a" },
      }),
      reCheckMs: 1000,
      onGetJob: async (call) => {
        if (call !== 2) return;
        reached();
        await held;
      },
    });

    const pending = transferRequest(harness.app, { method: "GET" });
    await atCheck;
    harness.state.job = { ...harness.state.job, status: "cancelled" };
    await vi.advanceTimersByTimeAsync(1000);
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r));
    release();

    const res = await pending;
    expect(res.status).toBe(409);
    expect(await res.text()).not.toContain("from the workspace");
    vi.useRealTimers();
  });

  it("stops sending when the job ends mid-read", async () => {
    const deferred = { release: () => {} };
    const harness = setup({
      job: job({
        tool: "upload",
        transferDirection: "upload",
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
