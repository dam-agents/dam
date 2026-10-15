// TEST_OVERVIEW: File listings name every entry of a directory, marking directories with a trailing slash, and recursively enumerate workspace paths through the existing file API, failing without partial output if a directory cannot be read.
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "api-server-api/router";
import {
  AGENT_UNREACHABLE,
  ALL_SCOPES,
  type Agent,
  type ApiContext,
} from "api-server-api";
import { appRouter as runtimeRouter } from "agent-runtime-api/router";
import type { AgentRuntimeContext, DirListResult } from "agent-runtime-api";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDam } from "./run-dam.js";

describe("dam file list (integration)", () => {
  let home: string;
  let server: Server;
  let host: string;
  let directories: Record<string, DirListResult>;
  let requested: string[];
  let batches: string[][];
  let requestLengths: number[];
  let agentState: Partial<Agent>;
  let relayAnswer: { status: number; type: string; body: string } | null;

  beforeEach(async () => {
    agentState = {};
    relayAnswer = null;
    home = await mkdtemp(join(tmpdir(), "dam-file-list-"));
    requested = [];
    batches = [];
    requestLengths = [];
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
          id: "agent-0000000000000001",
          name: "demo",
          templateId: "claude-code",
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
          ...agentState,
        }),
      },
    } as unknown as ApiContext;
    const runtimeContext = {
      files: {
        listDirs: async (paths: string[]) => {
          requested.push(...paths);
          batches.push(paths);
          return paths.map(
            (path): DirListResult =>
              directories[path] ?? { path, ok: false, error: "not-found" },
          );
        },
      },
    } as unknown as AgentRuntimeContext;

    server = createServer(async (req, res) => {
      requestLengths.push(Buffer.byteLength(req.url ?? ""));
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
      if (relayAnswer && req.url?.startsWith("/api/agents/")) {
        res.writeHead(relayAnswer.status, { "Content-Type": relayAnswer.type });
        res.end(relayAnswer.body);
        return;
      }
      const request = new Request(`http://localhost${req.url}`);
      const response = req.url?.startsWith(
        "/api/agents/agent-0000000000000001/trpc/",
      )
        ? await fetchRequestHandler({
            endpoint: "/api/agents/agent-0000000000000001/trpc",
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

  function runList(...args: string[]) {
    return runDam(
      ["file", "list", "agent-0000000000000001", "--server", host, ...args],
      {
        HOME: home,
        XDG_CONFIG_HOME: home,
        XDG_STATE_HOME: home,
        DAM_TOKEN: "test-token",
      },
    );
  }

  it("lists directories and files of one directory, marking directories with a trailing slash", async () => {
    const result = await runList();
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toBe("empty/\nsrc/\nREADME.md\n");
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

  it("-R lists every nested path, including empty directories", async () => {
    const result = await runList("-R");
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toBe(
      "empty/\nREADME.md\nsrc/\nsrc/index.ts\nsrc/nested/\nsrc/nested/hello world.ts\n",
    );
    expect(requested.sort()).toEqual(["", "empty", "src", "src/nested"]);
    expect(batches).toEqual([[""], ["empty", "src"], ["src/nested"]]);
  });

  it("-R lists a linked folder without descending into it", async () => {
    directories[""] = {
      path: "",
      ok: true,
      entries: [
        { name: "self", type: "dir", symlink: true },
        { name: "README.md", type: "file" },
      ],
    };

    const result = await runList("-R");
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toBe("README.md\nself/\n");
    expect(requested).toEqual([""]);
  });

  it.each([
    { count: 501, prefix: "package-with-a-realistic-directory-name-" },
    { count: 501, prefix: "深い フォルダー%#?-" },
  ])(
    "lists $count directories named $prefix within the API and URL limits",
    async ({ count, prefix }) => {
      const paths = Array.from(
        { length: count },
        (_, index) => `${prefix}${index}`,
      );
      directories = {
        "": {
          path: "",
          ok: true,
          entries: paths.map((name) => ({ name, type: "dir" })),
        },
      };
      for (const path of paths) {
        directories[path] = {
          path,
          ok: true,
          entries: [{ name: "nested", type: "dir" }],
        };
        directories[`${path}/nested`] = {
          path: `${path}/nested`,
          ok: true,
          entries: [{ name: "file.txt", type: "file" }],
        };
      }

      const result = await runList("-R", "--json");
      expect(result.exitCode, result.stderr).toBe(0);
      const nested = paths.map((path) => `${path}/nested`);
      expect(batches.flat()).toEqual(["", ...paths, ...nested]);
      expect(batches.every((batch) => batch.length <= 500)).toBe(true);
      expect(batches.length).toBeLessThan(25);
      expect(Math.max(...requestLengths)).toBeLessThan(7_200);
      expect(JSON.parse(result.stdout)).toEqual(
        paths
          .flatMap((path) => [
            { path, type: "dir" },
            { path: `${path}/nested`, type: "dir" },
            { path: `${path}/nested/file.txt`, type: "file" },
          ])
          .sort((a, b) => a.path.localeCompare(b.path)),
      );
    },
  );

  it.each([{ flags: [] }, { flags: ["-R", "--json"] }])(
    "rejects a requested directory over the URL budget before listing it ($flags)",
    async ({ flags }) => {
      const path = Array.from({ length: 12 }, () => "深".repeat(70)).join("/");
      directories[path] = { path, ok: true, entries: [] };

      const result = await runList(path, ...flags);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(
        "directory path exceeds the request URL size limit",
      );
      expect(batches).toEqual([]);
    },
  );

  it("fails without partial output when a nested directory exceeds the URL budget", async () => {
    let path = "src";
    for (let depth = 0; depth < 12; depth++) {
      const name = "深".repeat(70);
      directories[path] = {
        path,
        ok: true,
        entries: [{ name, type: "dir" }],
      };
      path = `${path}/${name}`;
    }
    directories[path] = { path, ok: true, entries: [] };

    const result = await runList("-R", "--json");
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "directory path exceeds the request URL size limit",
    );
    expect(requested).toContain("src");
    expect(requested).not.toContain(path);
    expect(Math.max(...requestLengths)).toBeLessThan(7_200);
  });

  it("fails without partial output when a sibling in a batch cannot be read", async () => {
    directories.src = { path: "src", ok: false, error: "forbidden" };
    const result = await runList("-R", "--json");
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("cannot list `src`: forbidden");
    expect(batches).toEqual([[""], ["empty", "src"]]);
  });

  it("scopes recursion to the requested subtree and strips trailing slashes", async () => {
    const result = await runList("src///", "--recursive");
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toBe(
      "src/index.ts\nsrc/nested/\nsrc/nested/hello world.ts\n",
    );
    expect(requested).toEqual(["src", "src/nested"]);
  });

  it("names a subdirectory the user can descend into when listing it shallowly", async () => {
    const result = await runList("src");
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toBe("src/nested/\nsrc/index.ts\n");
    expect(requested).toEqual(["src"]);
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
    { flags: [], output: "" },
    { flags: ["-R", "--json"], output: "[]\n" },
  ])(
    "returns empty output for an empty subtree ($flags)",
    async ({ flags, output }) => {
      const result = await runList("empty", ...flags);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).toBe(output);
    },
  );

  it("fails without partial output when a nested directory is missing", async () => {
    directories["src/nested"] = {
      path: "src/nested",
      ok: false,
      error: "not-found",
    };
    const result = await runList("-R", "--json");
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("cannot list `src/nested`: not-found");
  });

  it("reports a missing requested directory", async () => {
    const result = await runList("missing", "-R");
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("cannot list `missing`: not-found");
  });

  /**
   * TEST_SCENARIO: The api-server could not wake the agent because its owner's
   * VM memory is full, and answers with its own body carrying the reason. The
   * listing says the agent could not start and why, not that the server could
   * not be reached, and exits with the agent-not-reachable code.
   */
  it("says why the agent could not start when the server could not wake it", async () => {
    relayAnswer = {
      status: 502,
      type: "application/json",
      body: JSON.stringify({
        error: AGENT_UNREACHABLE,
        reason: "over-budget",
        message: "Your VM agents are using 23.5 of 24.0 GiB of memory",
      }),
    };

    const result = await runList();
    expect(result.exitCode).toBe(7);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      'error: agent "demo" could not start: Your VM agents are using 23.5 of 24.0 GiB of memory\n',
    );
  });

  /**
   * TEST_SCENARIO: A gateway in front of the api-server gives up on a slow wake
   * and answers with an HTML error page. The listing reads why from the
   * agent's own state, the storage-full sentence the web app shows, instead of
   * failing to parse the page as JSON.
   */
  it("reads why from the agent when a gateway answers with an HTML page", async () => {
    relayAnswer = {
      status: 504,
      type: "text/html",
      body: "<html><body><h1>504 Gateway Time-out</h1></body></html>",
    };
    agentState = {
      state: "error",
      podTerminationReason: "your VM agents' storage is full",
    };

    const result = await runList();
    expect(result.exitCode).toBe(7);
    expect(result.stderr).toBe(
      'error: agent "demo" could not start: your VM agents\' storage is full\n',
    );
  });

  /**
   * TEST_SCENARIO: An HTML error page for an agent that is not failing names
   * the HTTP status the server answered with, not a JSON parse error and not
   * "cannot reach server".
   */
  it("names the HTTP status of an HTML error page when the agent is not failing", async () => {
    relayAnswer = {
      status: 502,
      type: "text/html",
      body: "<html><body>Bad Gateway</body></html>",
    };

    const result = await runList();
    expect(result.exitCode).toBe(7);
    expect(result.stderr).toBe(
      "error: the server answered HTTP 502 Bad Gateway with a body that is not an API response\n",
    );
  });
});
