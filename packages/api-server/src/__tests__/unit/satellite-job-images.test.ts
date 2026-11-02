import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { TRPCError } from "@trpc/server";
import {
  MAX_JOB_IMAGES,
  MAX_JOB_OUTPUT_BYTES,
  reportInputSchema,
  satelliteImagesSchema,
  storedPayloadBytes,
  type JobOutcome,
  type SatelliteView,
} from "api-server-api";
import { afterEach, describe, expect, it } from "vitest";
import { logInternalError } from "../../apps/api-server/trpc/log-internal-error.js";
import { configureLogger } from "../../core/logger.js";
import type { JobRow as Row } from "../../modules/satellites/domain/types.js";
import { createSatellitesRepository } from "../../modules/satellites/infrastructure/satellites-repository.js";
import { registerSatelliteTools } from "../../modules/satellites/mcp-tools.js";
import { createSatelliteAgentOps } from "../../modules/satellites/services/agent-ops.js";
import { createSatelliteWorkerOps } from "../../modules/satellites/services/worker-ops.js";

/**
 * TEST_OVERVIEW: What an Agent receives from a Satellite tool that returns an
 * image, and what the platform will accept from the machine that sends one. The
 * outcome rides the platform MCP server as the image block the tool produced —
 * same base64, same media type — beside the JSON that describes the Job, because
 * a picture is what the model can look at and base64 in a text block is not. The
 * JSON keeps its record without the image bytes, so one image is not charged to
 * the context twice, and an error result keeps its image too.
 *
 * The machine is untrusted, so the report contract is where an image is checked:
 * base64, a media type a harness shows, and text plus images within one ceiling.
 * A settlement that fails must not carry those bytes into the log either, which
 * is why the driver's message never reaches it.
 */

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

const IMAGE = { type: "image", data: PNG_1X1, mimeType: "image/png" } as const;

const REPORT = {
  satellite: "gpu-box",
  sequence: 7,
  outcome: {
    status: "done" as const,
    isError: false,
    exitCode: 0,
    output: "the plot",
    truncated: false,
    images: [IMAGE],
  },
};

function view(tools: string[]): SatelliteView {
  return {
    name: "gpu-box",
    description: null,
    host: null,
    online: true,
    draining: false,
    lastSeenAt: null,
    tools: tools.map((t) => ({ name: t, inputSchema: { type: "object" } })),
    maxConcurrent: 16,
    activeJobs: 0,
    grantedAgentIds: [],
  };
}

function outcome(patch: Partial<JobOutcome> = {}): JobOutcome {
  return {
    ref: "gpu-box#7",
    status: "done",
    isError: false,
    exitCode: 0,
    output: "the plot",
    outputPath: null,
    truncated: false,
    reason: null,
    images: [IMAGE],
    ...patch,
  };
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  ops: { start: unknown; wait: unknown; read: unknown },
) {
  const server = new McpServer({ name: "platform", version: "1.0.0" });
  registerSatelliteTools(server, {
    ops: ops as never,
    agentId: "agent-1",
    satellites: [view(["plot"])],
    waitDeadlineMs: 1000,
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  try {
    const result = await client.callTool({ name, arguments: args });
    return result as CallToolResult;
  } finally {
    await client.close();
    await server.close();
  }
}

function settledOps(settled: JobOutcome) {
  return {
    start: async () => ({
      ref: "gpu-box#7",
      satellite: "gpu-box",
      sequence: 7,
      status: "queued",
    }),
    wait: async () => settled,
    read: async () => settled,
    cancel: async () => settled,
  };
}

describe("an image a satellite tool returned", () => {
  it("reaches the agent as the image block it was", async () => {
    const result = await callTool("gpu_box__plot", {}, settledOps(outcome()));
    const [text, image] = result.content as { type: string; text?: string }[];
    expect(text?.type).toBe("text");
    expect(image).toEqual(IMAGE);
  });

  it("is not also written into the text as base64", async () => {
    const result = await callTool("gpu_box__plot", {}, settledOps(outcome()));
    const text = (result.content[0] as { text: string }).text;
    expect(JSON.parse(text)).toMatchObject({
      ref: "gpu-box#7",
      status: "done",
      output: "the plot",
    });
    expect(text).not.toContain(PNG_1X1);
  });

  it("stays even though the tool returned an error", async () => {
    const result = await callTool(
      "gpu_box__plot",
      {},
      settledOps(outcome({ isError: true, exitCode: 1 })),
    );
    expect(result.isError).toBe(true);
    expect(result.content[1]).toEqual(IMAGE);
  });

  it("has no image block to add when the tool returned only text", async () => {
    const result = await callTool(
      "gpu_box__plot",
      {},
      settledOps(outcome({ images: [] })),
    );
    expect(result.content).toHaveLength(1);
  });
});

describe("the images a report may carry", () => {
  const image = (bytes: number) => ({ ...IMAGE, data: "A".repeat(bytes) });
  const report = (images: unknown[], output = "the plot") => ({
    ...REPORT,
    outcome: { ...REPORT.outcome, images, output },
  });

  it("takes a handful that fit the ceiling", () => {
    expect(
      satelliteImagesSchema.parse([image(1024), image(2048)]),
    ).toHaveLength(2);
  });

  it("takes a payload that is exactly the ceiling, and refuses one byte more", () => {
    const room =
      MAX_JOB_OUTPUT_BYTES -
      storedPayloadBytes({
        output: REPORT.outcome.output,
        images: [image(4), image(4)],
      });
    const bigger = 4 + room - (room % 4);
    expect(
      reportInputSchema.safeParse(report([image(4), image(bigger)])).success,
    ).toBe(true);
    expect(
      reportInputSchema.safeParse(report([image(4), image(bigger + 4)]))
        .success,
    ).toBe(false);
  });

  it("refuses images that are each allowed but together pass the ceiling", () => {
    expect(
      reportInputSchema.safeParse(report([image(600_000), image(600_000)]))
        .success,
    ).toBe(false);
  });

  it("counts the text against the ceiling in bytes, not characters", () => {
    const wide = "\u0800".repeat(Math.ceil((MAX_JOB_OUTPUT_BYTES + 30) / 3));
    expect(
      reportInputSchema.safeParse(report([], wide)).success,
      "a report with no image keeps the character cap it always had",
    ).toBe(true);
    expect(
      reportInputSchema.safeParse(report([image(4096)], wide)).success,
    ).toBe(false);
  });

  /**
   * TEST_SCENARIO: A control character is one byte stored and six once the JSON
   * has escaped it, so text measured before that is written reaches an Agent up
   * to six times its size — and spilling it to a file is not a guarantee, since
   * an Agent's workspace can refuse one. The ceiling is therefore taken on the
   * escaped form, and the two lengths here differ only by one character.
   */
  it("counts the escaped text, so an image-bearing report cannot escape its ceiling", () => {
    const envelope = storedPayloadBytes({ output: "", images: [IMAGE] });
    const fits = Math.floor((MAX_JOB_OUTPUT_BYTES - envelope) / 6);
    const escaped = (chars: number) => report([IMAGE], "\u0001".repeat(chars));
    expect(reportInputSchema.safeParse(escaped(fits)).success).toBe(true);
    expect(reportInputSchema.safeParse(escaped(fits + 1)).success).toBe(false);
  });

  it("refuses more images than a Job may carry", () => {
    const tooMany = Array.from({ length: MAX_JOB_IMAGES + 1 }, () => image(16));
    expect(satelliteImagesSchema.safeParse(tooMany).success).toBe(false);
  });

  it("refuses data that is not base64", () => {
    expect(
      satelliteImagesSchema.safeParse([{ ...IMAGE, data: "not base64" }])
        .success,
    ).toBe(false);
  });

  it("refuses padding that no encoder writes, so the bytes are the ones measured", () => {
    expect(
      satelliteImagesSchema.safeParse([{ ...IMAGE, data: "AA==" }]).success,
    ).toBe(true);
    for (const data of ["AB==", "AAB="])
      expect(
        satelliteImagesSchema.safeParse([{ ...IMAGE, data }]).success,
      ).toBe(false);
  });

  it("refuses a media type a harness cannot show", () => {
    for (const mimeType of [
      "image/svg+xml",
      "text/html",
      "application/octet-stream",
    ])
      expect(
        satelliteImagesSchema.safeParse([{ ...IMAGE, mimeType }]).success,
      ).toBe(false);
  });
});

describe("a reported job read back", () => {
  function world() {
    const rows = new Map<string, Row>();
    rows.set("gpu-box#7", {
      owner: "alice",
      satellite: "gpu-box",
      sequence: 7,
      agentId: "agent-1",
      tool: "plot",
      args: {},
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
    });
    const repo = {
      settle: async (
        _owner: string,
        _satellite: string,
        sequence: number,
        patch: Partial<Row>,
      ) => {
        const row = rows.get(`gpu-box#${sequence}`)!;
        const settled = { ...row, ...patch, status: "done" as const };
        rows.set(`gpu-box#${sequence}`, settled);
        return settled;
      },
      getJob: async (_owner: string, _satellite: string, sequence: number) =>
        rows.get(`gpu-box#${sequence}`) ?? null,
      get: async () => ({
        owner: "alice",
        name: "gpu-box",
        description: null,
        host: null,
        maxConcurrent: 16,
        tools: [{ name: "plot", inputSchema: {} }],
        draining: false,
        lastSeenAt: new Date(),
      }),
      grantedNames: async () => [{ owner: "alice", name: "gpu-box" }],
      markSeen: async () => true,
      markAwaited: async () => true,
      releaseAwaited: async () => {},
      activeJobs: async () => [],
    };
    const workerOps = createSatelliteWorkerOps({
      repo: repo as never,
      maxConcurrentCeiling: 64,
      deliverOutcome: async () => {},
    });
    const agentOps = createSatelliteAgentOps({
      repo: repo as never,
      ownerOf: async () => "alice",
      spillLog: async () => null,
    });
    return { rows, workerOps, agentOps };
  }

  it("stores the image the worker reported and hands it to the get and wait verbs", async () => {
    const { rows, workerOps, agentOps } = world();
    await workerOps.report("alice", REPORT);
    expect(
      rows.get("gpu-box#7")?.images,
      "the settlement must keep what the worker sent",
    ).toEqual([IMAGE]);

    for (const verb of ["gpu_box__get", "gpu_box__wait"]) {
      const result = await callTool(verb, { job: 7 }, agentOps);
      expect(result.content[1], verb).toEqual(IMAGE);
      expect((result.content[0] as { text: string }).text).not.toContain(
        PNG_1X1,
      );
    }
  });

  /**
   * TEST_SCENARIO: The upload ceiling means nothing if the Agent's copy is
   * bigger than the Job's. A payload at the ceiling of escaped text, with a
   * workspace that refuses the spill file, must still come back within the same
   * ceiling — which is why the envelope around it is reserved rather than
   * hoped for.
   */
  it("returns a job at the ceiling within it, even when the text cannot be spilled", async () => {
    const { workerOps, agentOps } = world();
    const envelope = storedPayloadBytes({ output: "", images: [IMAGE] });
    const text = "\u0001".repeat(
      Math.floor((MAX_JOB_OUTPUT_BYTES - envelope) / 6),
    );
    await workerOps.report("alice", {
      ...REPORT,
      outcome: { ...REPORT.outcome, output: text },
    });

    const result = await callTool("gpu_box__get", { job: 7 }, agentOps);
    const served = new TextEncoder().encode(
      (result.content[0] as { text: string }).text,
    ).length;
    expect(
      served,
      "the text an Agent reads is bigger than the ceiling allows",
    ).toBeLessThanOrEqual(MAX_JOB_OUTPUT_BYTES);
    expect(result.content[1]).toEqual(IMAGE);
  });
});

describe("a settlement that fails", () => {
  const CAPTURED: string[] = [];
  afterEach(() => {
    CAPTURED.length = 0;
    configureLogger({ level: "info" });
  });

  function driverFailure(code: string) {
    return Object.assign(
      new Error(
        `Failed query: update "satellite_jobs" set "images" = $1\nparams: ${PNG_1X1}`,
      ),
      { cause: { code } },
    );
  }

  function failingRepo(err: unknown) {
    const chain = {
      update: () => chain,
      set: () => chain,
      where: () => chain,
      returning: async () => {
        throw err;
      },
    };
    return createSatellitesRepository(chain as never);
  }

  it("names the job and the driver's code, never the payload it was writing", async () => {
    const workerOps = createSatelliteWorkerOps({
      repo: failingRepo(driverFailure("57P01")),
      maxConcurrentCeiling: 64,
      deliverOutcome: async () => {},
    });
    const failure = await workerOps
      .report("alice", REPORT)
      .catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(Error);
    const message = (failure as Error).message;
    expect(message).toContain("gpu-box#7");
    expect(message).toContain("57P01");
    expect(message).not.toContain(PNG_1X1);
    expect(
      (failure as Error).cause,
      "a cause is what the logger serializes next",
    ).toBeUndefined();
  });

  it("reaches the log without the image either", async () => {
    const workerOps = createSatelliteWorkerOps({
      repo: failingRepo(driverFailure("57P01")),
      maxConcurrentCeiling: 64,
      deliverOutcome: async () => {},
    });
    const failure = await workerOps
      .report("alice", REPORT)
      .catch((err: unknown) => err);

    configureLogger({
      level: "error",
      write: (line: string) => CAPTURED.push(line),
    });
    logInternalError({
      error: new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        cause: failure,
      }),
      path: "satellites.report",
    });

    expect(CAPTURED).toHaveLength(1);
    expect(CAPTURED[0]).toContain("trpc internal error");
    expect(CAPTURED[0]).not.toContain(PNG_1X1);
    expect(CAPTURED[0]).not.toContain("params:");
  });
});
