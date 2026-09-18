// TEST_OVERVIEW: File listings preserve shallow output and recursively enumerate workspace paths through the existing file API, failing without partial output if a directory cannot be read.
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "api-server-api/router";
import { ALL_SCOPES, type Agent, type ApiContext } from "api-server-api";
import { appRouter as runtimeRouter } from "agent-runtime-api/router";
import type { AgentRuntimeContext, DirListResult } from "agent-runtime-api";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const exec = promisify(execFile);
const BIN_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../dist/bin.js",
);

describe("dam file list (integration)", () => {
  let home: string;
  let server: Server;
  let host: string;
  let directories: Record<string, DirListResult>;
  let requested: string[];

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "dam-file-list-"));
    requested = [];
    directories = {
      "": {
        path: "",
        ok: true,
        entries: [
          { name: "empty", type: "dir" },
          { name: "src", type: "dir" },
          { name: "README.md", type: "file" },
        ],
      },
      empty: { path: "empty", ok: true, entries: [] },
      src: {
        path: "src",
        ok: true,
        entries: [
          { name: "nested", type: "dir" },
          { name: "index.ts", type: "file" },
        ],
      },
      "src/nested": {
        path: "src/nested",
        ok: true,
        entries: [{ name: "hello world.ts", type: "file" }],
      },
    };
    const apiContext = {
      user: { sub: "fixture-user", scopes: ALL_SCOPES, agentIds: "*" },
      terms: { isAccepted: async () => true },
      invocationsQuery: { listTargets: async () => [] },
      agents: {
        get: async (): Promise<Agent> => ({
          id: "agent-1",
          name: "demo",
          templateId: "claude-code",
          spec: { name: "demo", image: "" },
          state: "running",
          effectiveHibernationTimeoutMin: 60,
          features: { liveUpdates: true },
          stopRequested: false,
          overBudget: false,
          contributionFailures: [],
          unsupportedContributionKinds: [],
          channels: [],
        }),
      },
    } as unknown as ApiContext;
    const runtimeContext = {
      files: {
        listDirs: async (paths: string[]) => {
          requested.push(...paths);
          return paths.map(
            (path): DirListResult =>
              directories[path] ?? { path, ok: false, error: "not-found" },
          );
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
      if (req.headers.authorization !== "Bearer test-token") {
        res.writeHead(401).end();
        return;
      }
      const request = new Request(`http://localhost${req.url}`);
      const response = req.url?.startsWith("/api/agents/agent-1/trpc/")
        ? await fetchRequestHandler({
            endpoint: "/api/agents/agent-1/trpc",
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

  async function runList(...args: string[]) {
    try {
      const result = await exec(
        process.execPath,
        [BIN_PATH, "file", "list", "agent-1", "--server", host, ...args],
        {
          env: {
            HOME: home,
            XDG_CONFIG_HOME: home,
            XDG_STATE_HOME: home,
            DAM_TOKEN: "test-token",
          },
        },
      );
      return { exitCode: 0, ...result };
    } catch (error) {
      const result = error as { code: number; stdout: string; stderr: string };
      return {
        exitCode: result.code,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    }
  }

  it("keeps the default listing shallow and files-only", async () => {
    const result = await runList();
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toBe("README.md\n");
    expect(requested).toEqual([""]);
  });

  it("keeps directory entries in shallow JSON output", async () => {
    const result = await runList("--json");
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([
      { path: "empty", type: "dir" },
      { path: "src", type: "dir" },
      { path: "README.md", type: "file" },
    ]);
    expect(requested).toEqual([""]);
  });

  it.each(["-R", "--recursive"])(
    "%s lists every nested path, including empty directories",
    async (flag) => {
      const result = await runList(flag);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).toBe(
        "empty/\nREADME.md\nsrc/\nsrc/index.ts\nsrc/nested/\nsrc/nested/hello world.ts\n",
      );
      expect(requested.sort()).toEqual(["", "empty", "src", "src/nested"]);
    },
  );

  it("scopes recursion to the requested subtree and strips trailing slashes", async () => {
    const result = await runList("src///", "-R");
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toBe(
      "src/index.ts\nsrc/nested/\nsrc/nested/hello world.ts\n",
    );
    expect(requested).toEqual(["src", "src/nested"]);
  });

  it("returns recursive JSON with the existing path and type shape", async () => {
    const result = await runList("src", "-R", "--json");
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([
      { path: "src/index.ts", type: "file" },
      { path: "src/nested", type: "dir" },
      { path: "src/nested/hello world.ts", type: "file" },
    ]);
  });

  it.each([
    { flags: ["-R"], output: "" },
    { flags: ["-R", "--json"], output: "[]\n" },
  ])(
    "returns empty output for an empty subtree ($flags)",
    async ({ flags, output }) => {
      const result = await runList("empty", ...flags);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).toBe(output);
    },
  );

  it.each(["not-found", "forbidden"] as const)(
    "fails without partial output when a nested directory is %s",
    async (error) => {
      directories["src/nested"] = { path: "src/nested", ok: false, error };
      const result = await runList("-R", "--json");
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(`cannot list \`src/nested\`: ${error}`);
    },
  );

  it("reports a missing requested directory", async () => {
    const result = await runList("missing", "-R");
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("cannot list `missing`: not-found");
  });
});
