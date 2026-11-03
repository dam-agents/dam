import { createHash } from "node:crypto";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { SATELLITE_FILE_MAX_BYTES, type UserIdentity } from "api-server-api";
import type { ApiVariables } from "../../core/http-context.js";
import type { JobRow } from "../../modules/satellites/domain/types.js";
import type {
  SatelliteWorkspaceFiles,
  WorkspaceRead,
} from "../../modules/satellites/infrastructure/agent-workspace-files.js";
import type { SatellitesRepository } from "../../modules/satellites/infrastructure/satellites-repository.js";
import { createSatelliteFileRoutes } from "../../modules/satellites/routes/file-transfer.js";

/**
 * TEST_OVERVIEW: One file crossing between a machine and an Agent's workspace,
 * in either direction, on its own request rather than in a Job's result. The
 * platform authorises a transfer by a Job that is running right now, decides
 * where a received file lands, and refuses a name or a workspace path that
 * tries to walk out. The specs pin that boundary: the serve key and the Job it
 * names, the single-segment name, the workspace path, and the size cap.
 */

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

function setup(
  options: {
    found?: JobRow | null;
    user?: UserIdentity;
    read?: WorkspaceRead;
  } = {},
) {
  const found = options.found === undefined ? job() : options.found;
  const written: { agentId: string; path: string; bytes: Buffer }[] = [];
  const files: SatelliteWorkspaceFiles = {
    write: async ({ agentId, path, bytes }) => {
      written.push({ agentId, path, bytes });
      return `/home/agent/${path}`;
    },
    read: async () => options.read ?? { ok: true, bytes: Buffer.from("bytes") },
  };
  const repo = {
    getJob: async () => found,
  } as unknown as SatellitesRepository;

  const app = new Hono<{ Variables: ApiVariables }>();
  app.use("*", async (c, next) => {
    c.set("user", options.user ?? SERVE_KEY);
    c.set("roles", []);
    c.set("surface", "api");
    await next();
  });
  app.route("/", createSatelliteFileRoutes({ repo, files }));
  return { app, written };
}

describe("a file the machine sends into the agent's workspace", () => {
  it("writes it where the platform decides and reports path, size and sha256", async () => {
    const { app, written } = setup();
    const bytes = Buffer.from("line one\n");

    const res = await app.request(
      "/api/satellites/laptop/jobs/7/file?name=app.log",
      {
        method: "POST",
        body: bytes,
      },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      path: "/home/agent/.dam/satellite-files/laptop-7/app.log",
      size: bytes.length,
      sha256: sha256(bytes),
    });
    expect(written).toHaveLength(1);
    expect(written[0]?.agentId).toBe("agent-1");
    expect(written[0]?.path).toBe(".dam/satellite-files/laptop-7/app.log");
    expect(written[0]?.bytes.toString("utf8")).toBe("line one\n");
  });

  it("refuses a name that is more than one segment", async () => {
    const { app, written } = setup();
    for (const name of [
      "../escape.log",
      "nested/app.log",
      "a\\b",
      "..",
      "",
      "/etc/passwd",
    ]) {
      const res = await app.request(
        `/api/satellites/laptop/jobs/7/file?name=${encodeURIComponent(name)}`,
        { method: "POST", body: Buffer.from("x") },
      );
      expect(res.status).toBe(400);
    }
    expect(written).toHaveLength(0);
  });

  it("refuses a body over the cap without writing anything", async () => {
    const { app, written } = setup();
    const res = await app.request(
      "/api/satellites/laptop/jobs/7/file?name=app.log",
      {
        method: "POST",
        headers: { "content-length": String(SATELLITE_FILE_MAX_BYTES + 1) },
        body: Buffer.from("x"),
      },
    );
    expect(res.status).toBe(413);
    expect(written).toHaveLength(0);
  });

  it("refuses a job that is not running, and one that does not exist", async () => {
    const finished = setup({ found: job({ status: "done" }) });
    const settled = await finished.app.request(
      "/api/satellites/laptop/jobs/7/file",
      {
        method: "POST",
        headers: { "x-dam-file-name": "app.log" },
        body: Buffer.from("x"),
      },
    );
    expect(settled.status).toBe(409);
    expect(finished.written).toHaveLength(0);

    const unknown = setup({ found: null });
    const missing = await unknown.app.request(
      "/api/satellites/laptop/jobs/7/file",
      {
        method: "POST",
        headers: { "x-dam-file-name": "app.log" },
        body: Buffer.from("x"),
      },
    );
    expect(missing.status).toBe(404);
  });

  it("refuses a key that is not a serve key, or that is bound to one agent", async () => {
    for (const user of [
      { ...SERVE_KEY, scopes: ["agents:operate"] },
      { ...SERVE_KEY, agentIds: ["agent-1"] },
    ] as UserIdentity[]) {
      const { app, written } = setup({ user });
      const res = await app.request("/api/satellites/laptop/jobs/7/file", {
        method: "POST",
        headers: { "x-dam-file-name": "app.log" },
        body: Buffer.from("x"),
      });
      expect(res.status).toBe(403);
      expect(written).toHaveLength(0);
    }
  });

  it("reports a workspace that refuses the file", async () => {
    const app = createSatelliteFileRoutes({
      repo: { getJob: async () => job() } as unknown as SatellitesRepository,
      files: {
        write: async () => {
          throw new Error("no room");
        },
        read: async () => ({ ok: false, reason: "unreachable" }),
      },
    });
    const guarded = new Hono<{ Variables: ApiVariables }>();
    guarded.use("*", async (c, next) => {
      c.set("user", SERVE_KEY);
      c.set("roles", []);
      c.set("surface", "api");
      await next();
    });
    guarded.route("/", app);

    const res = await guarded.request(
      "/api/satellites/laptop/jobs/7/file?name=app.log",
      {
        method: "POST",
        body: Buffer.from("x"),
      },
    );
    expect(res.status).toBe(502);
  });
});

describe("a file the machine asks the agent's workspace for", () => {
  it("answers with the bytes and their length", async () => {
    const bytes = Buffer.from("from the workspace");
    const { app } = setup({ read: { ok: true, bytes } });

    const res = await app.request(
      "/api/satellites/laptop/jobs/7/file?path=work%2Freport.csv",
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe(String(bytes.length));
    expect(Buffer.from(await res.arrayBuffer()).toString("utf8")).toBe(
      "from the workspace",
    );
  });

  it("takes an absolute workspace path the way a download reported it", async () => {
    const { app } = setup();
    const res = await app.request(
      "/api/satellites/laptop/jobs/7/file?path=%2Fhome%2Fagent%2Fwork%2Freport.csv",
    );
    expect(res.status).toBe(200);
  });

  it("refuses a workspace path with a .. segment", async () => {
    const { app } = setup();
    const res = await app.request(
      "/api/satellites/laptop/jobs/7/file?path=work%2F..%2F..%2Fetc%2Fpasswd",
    );
    expect(res.status).toBe(400);
  });

  it("maps the workspace's own refusals", async () => {
    for (const [reason, status] of [
      ["not-found", 404],
      ["too-large", 413],
      ["unreachable", 502],
    ] as const) {
      const { app } = setup({ read: { ok: false, reason } });
      const res = await app.request(
        "/api/satellites/laptop/jobs/7/file?path=work%2Freport.csv",
      );
      expect(res.status).toBe(status);
    }
  });
});
