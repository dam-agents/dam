// TEST_OVERVIEW: `dam file get --stdout` hands every byte of the file to a pipe before the CLI exits, so a piped copy is never cut short at the pipe buffer.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "api-server-api/router";
import { ALL_SCOPES, type Agent, type ApiContext } from "api-server-api";
import { appRouter as runtimeRouter } from "agent-runtime-api/router";
import type { AgentRuntimeContext } from "agent-runtime-api";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BIN_PATH } from "./run-dam.js";

describe("dam file get --stdout (integration)", () => {
  const file = randomBytes(3_000_000);
  let home: string;
  let server: Server;
  let host: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "dam-file-get-"));
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
          overBudget: false,
          podRestarts: 0,
          contributionFailures: [],
          unsupportedContributionKinds: [],
          workspaceFailures: [],
          channels: [],
        }),
      },
    } as unknown as ApiContext;
    const runtimeContext = {
      files: {
        readFileSafe: async (path: string) => ({
          ok: true,
          value: {
            path,
            content: file.toString("base64"),
            binary: true,
            mimeType: "application/octet-stream",
            mtimeMs: 0,
          },
        }),
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

  function getToStdout() {
    return spawn(
      process.execPath,
      [
        BIN_PATH,
        "file",
        "get",
        "agent-0000000000000001",
        "big.bin",
        "--stdout",
        "--server",
        host,
      ],
      {
        env: {
          HOME: home,
          XDG_CONFIG_HOME: home,
          XDG_STATE_HOME: home,
          DAM_TOKEN: "test-token",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  }

  it("writes a file larger than the pipe buffer to a pipe in full", async () => {
    const child = getToStdout();
    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    const exitCode = await new Promise<number | null>((done) =>
      child.on("close", done),
    );

    expect(exitCode, stderr).toBe(0);
    const received = Buffer.concat(chunks);
    expect(received.length).toBe(file.length);
    expect(received.equals(file)).toBe(true);
  });

  // TEST_SCENARIO: A reader that closes the pipe early, like `| head -c 10`, ends the CLI with exit 0 and no stack trace.
  it("exits cleanly when the reader closes the pipe early", async () => {
    const child = getToStdout();
    let stderr = "";
    child.stdout.once("data", () => child.stdout.destroy());
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    const exitCode = await new Promise<number | null>((done) =>
      child.on("close", done),
    );

    expect(exitCode, stderr).toBe(0);
    expect(stderr).toBe("");
  });
});
