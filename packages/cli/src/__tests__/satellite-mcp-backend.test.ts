import { mkdtempSync, readFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  MAX_JOB_OUTPUT_BYTES,
  escapedTextBytes,
  reportInputSchema,
  satelliteNameSchema,
  storedPayloadBytes,
} from "api-server-api";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { parseServerUrl } from "../modules/satellite/commands/mcp.js";
import {
  defaultSatelliteName,
  mcpDefaultName,
  shellDefaultName,
  uiGuide,
} from "../modules/satellite/commands/shared.js";
import { createMcpBackend } from "../modules/satellite/services/mcp-backend.js";

/**
 * TEST_OVERVIEW: A Satellite in front of an MCP server that is already
 * listening, reached by URL rather than started by the worker. The specs run a
 * real Streamable HTTP server and pin that its tools are what the Satellite
 * offers, that a call is forwarded and its result comes back, and that headers
 * the user passes reach the server, since an existing server usually wants
 * credentials. An image a tool returns travels on as the block it was, so the
 * agent meets a picture rather than a placeholder, and one too large to carry is
 * reported in the output rather than dropped. They also pin how a --url is read,
 * the name a Satellite takes when given none, and the guide the worker prints
 * once connected.
 */

let server: Server;
let base: string;
const seenHeaders: IncomingHttpHeaders[] = [];

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

function mcpServer(): McpServer {
  const mcp = new McpServer({ name: "existing", version: "1.0.0" });
  mcp.registerTool(
    "greet",
    { description: "Greet someone", inputSchema: { who: z.string() } },
    async ({ who }) => ({ content: [{ type: "text", text: `hello ${who}` }] }),
  );
  mcp.registerTool("fail", { description: "Always fails" }, async () => ({
    isError: true,
    content: [{ type: "text", text: "nope" }],
  }));
  mcp.registerTool("plot", { description: "Plot something" }, async () => ({
    content: [
      { type: "text", text: "the plot" },
      { type: "image", data: PNG_1X1, mimeType: "image/png" },
    ],
  }));
  mcp.registerTool("huge", { description: "An image too large" }, async () => ({
    content: [
      {
        type: "image",
        data: "A".repeat(MAX_JOB_OUTPUT_BYTES + 4),
        mimeType: "image/png",
      },
    ],
  }));
  mcp.registerTool(
    "flood",
    { description: "More images than fit" },
    async () => ({
      content: [
        { type: "text", text: "four frames" },
        ...Array.from({ length: 4 }, () => ({
          type: "image" as const,
          data: "A".repeat(400_000),
          mimeType: "image/png",
        })),
      ],
    }),
  );
  mcp.registerTool(
    "sketch",
    { description: "Not a raster image" },
    async () => ({
      content: [
        {
          type: "image" as const,
          data: "PHN2Zz48L3N2Zz4=",
          mimeType: "image/svg+xml",
        },
      ],
    }),
  );
  mcp.registerTool(
    "dense",
    { description: "Text the JSON has to escape" },
    async () => ({
      content: [
        { type: "text", text: "\u0001".repeat(300_000) },
        { type: "image" as const, data: PNG_1X1, mimeType: "image/png" },
      ],
    }),
  );
  return mcp;
}

beforeAll(async () => {
  server = createServer((req, res) => {
    seenHeaders.push(req.headers);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    void mcpServer()
      .connect(transport)
      .then(() => transport.handleRequest(req, res));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

describe("a satellite forwarding to an MCP server by URL", () => {
  it("offers the server's tools and forwards a call to it", async () => {
    const backend = await createMcpBackend({
      kind: "url",
      url: parseServerUrl(base)!,
      headers: {},
    });
    try {
      expect(backend.tools.map((tool) => tool.name).sort()).toEqual([
        "dense",
        "fail",
        "flood",
        "greet",
        "huge",
        "plot",
        "sketch",
      ]);
      const outcome = await backend.call({
        sequence: 1,
        tool: "greet",
        args: { who: "satellite" },
      });
      expect(outcome).toMatchObject({
        status: "done",
        isError: false,
        output: "hello satellite",
      });
    } finally {
      await backend.close();
    }
  });

  it("reports the server's own error result as a finished call that failed", async () => {
    const backend = await createMcpBackend({
      kind: "url",
      url: parseServerUrl(base)!,
      headers: {},
    });
    try {
      const outcome = await backend.call({
        sequence: 1,
        tool: "fail",
        args: {},
      });
      expect(outcome).toMatchObject({ status: "done", isError: true });
    } finally {
      await backend.close();
    }
  });

  it("passes an image a tool returned through unchanged", async () => {
    const backend = await createMcpBackend({
      kind: "url",
      url: parseServerUrl(base)!,
      headers: {},
    });
    try {
      const outcome = await backend.call({
        sequence: 1,
        tool: "plot",
        args: {},
      });
      expect(outcome).toMatchObject({
        status: "done",
        output: "the plot\n[image image/png]",
        truncated: false,
        images: [{ type: "image", data: PNG_1X1, mimeType: "image/png" }],
      });
      expect(
        outcome.status === "done" ? outcome.output : "",
        "the base64 belongs to the image block, not to the text the model reads",
      ).not.toContain(PNG_1X1);
    } finally {
      await backend.close();
    }
  });

  it("says so in the output when an image is over the limit, rather than dropping it", async () => {
    const backend = await createMcpBackend({
      kind: "url",
      url: parseServerUrl(base)!,
      headers: {},
    });
    try {
      const outcome = await backend.call({
        sequence: 1,
        tool: "huge",
        args: {},
      });
      expect(outcome).toMatchObject({ status: "done", images: [] });
      expect(outcome.status === "done" ? outcome.output : "").toContain(
        "not passed on",
      );
    } finally {
      await backend.close();
    }
  });

  it("keeps the images that fit and names the ones that do not", async () => {
    const backend = await createMcpBackend({
      kind: "url",
      url: parseServerUrl(base)!,
      headers: {},
    });
    try {
      const outcome = await backend.call({
        sequence: 1,
        tool: "flood",
        args: {},
      });
      const kept = outcome.status === "done" ? (outcome.images ?? []) : [];
      expect(kept).toHaveLength(2);
      expect(kept.reduce((bytes, i) => bytes + i.data.length, 0)).toBeLessThan(
        MAX_JOB_OUTPUT_BYTES,
      );
      expect(outcome.status === "done" ? outcome.output : "").toContain(
        "not passed on",
      );
    } finally {
      await backend.close();
    }
  });

  it("measures the escaped text, so the report it sends is one the platform takes", async () => {
    const backend = await createMcpBackend({
      kind: "url",
      url: parseServerUrl(base)!,
      headers: {},
    });
    try {
      const outcome = await backend.call({
        sequence: 1,
        tool: "dense",
        args: {},
      });
      if (outcome.status !== "done") throw new Error(outcome.status);
      const output = outcome.output;
      const images = outcome.images ?? [];
      expect(
        escapedTextBytes(output),
        "the text is bounded after JSON escaping, not before it",
      ).toBeLessThanOrEqual(
        MAX_JOB_OUTPUT_BYTES - storedPayloadBytes({ output: "", images }),
      );
      expect(output.length).toBeLessThan(200_000);
      expect(
        reportInputSchema.safeParse({
          satellite: "test-box",
          sequence: 1,
          outcome: {
            status: "done",
            isError: outcome.isError,
            exitCode: outcome.exitCode,
            output,
            truncated: outcome.truncated,
            images,
          },
        }).success,
        "a report the platform would refuse would cost the job everything",
      ).toBe(true);
    } finally {
      await backend.close();
    }
  });

  it("refuses a block the contract will not take, and says why", async () => {
    const backend = await createMcpBackend({
      kind: "url",
      url: parseServerUrl(base)!,
      headers: {},
    });
    try {
      const outcome = await backend.call({
        sequence: 1,
        tool: "sketch",
        args: {},
      });
      expect(outcome).toMatchObject({ status: "done", images: [] });
      const text = outcome.status === "done" ? outcome.output : "";
      expect(text).toContain("image/svg+xml");
      expect(text).toContain("not passed on");
    } finally {
      await backend.close();
    }
  });

  it("sends the headers the user passed to the server", async () => {
    seenHeaders.length = 0;
    const backend = await createMcpBackend({
      kind: "url",
      url: parseServerUrl(base)!,
      headers: { Authorization: "Bearer secret" },
    });
    await backend.close();
    expect(seenHeaders.length).toBeGreaterThan(0);
    expect(seenHeaders.every((h) => h.authorization === "Bearer secret")).toBe(
      true,
    );
  });

  it("fails to connect with a reason when nothing listens there", async () => {
    await expect(
      createMcpBackend({
        kind: "url",
        url: new URL("http://127.0.0.1:1/mcp"),
        headers: {},
      }),
    ).rejects.toThrow();
  });
});

describe("reading --url", () => {
  it("fills in http and the conventional /mcp path for a bare host:port", () => {
    expect(parseServerUrl("localhost:8080")?.href).toBe(
      "http://localhost:8080/mcp",
    );
  });

  it("takes a URL with a scheme exactly as written", () => {
    expect(parseServerUrl("https://tools.lan/sse")?.href).toBe(
      "https://tools.lan/sse",
    );
    expect(parseServerUrl("http://tools.lan")?.href).toBe("http://tools.lan/");
  });

  it("refuses anything that is not http(s)", () => {
    expect(parseServerUrl("ftp://tools.lan")).toBeNull();
    expect(parseServerUrl("http://")).toBeNull();
  });
});

describe("the default satellite name", () => {
  it("falls back to one the platform accepts, naming who serves it from where", () => {
    const name = defaultSatelliteName();
    expect(name).toContain("@");
    expect(satelliteNameSchema.safeParse(name).success).toBe(true);
  });

  it("names an MCP satellite after the server it starts, past the runner", () => {
    const stdio = (...command: string[]) =>
      mcpDefaultName({
        kind: "stdio",
        command: command[0]!,
        args: command.slice(1),
      });
    expect(
      stdio("npx", "-y", "@modelcontextprotocol/server-filesystem", "/tmp"),
    ).toBe("server-filesystem");
    expect(stdio("uvx", "mcp-server-git")).toBe("mcp-server-git");
    expect(stdio("pnpm", "dlx", "@acme/build-mcp@1.2.0")).toBe("build-mcp");
    expect(stdio("python3", "-m", "mcp_server_time")).toBe("mcp-server-time");
    expect(stdio("./bin/Mise.sh", "mcp")).toBe("mise");
    expect(stdio("npx")).toBe(defaultSatelliteName());
  });

  it("names an MCP satellite after the host it forwards to", () => {
    expect(
      mcpDefaultName({
        kind: "url",
        url: new URL("http://Localhost:8080/mcp"),
        headers: {},
      }),
    ).toBe("localhost");
  });

  it("names a shell satellite after its one permitted command, else the machine", () => {
    expect(
      shellDefaultName(
        "./process.sh (a|b)  # one\n\n  ./process.sh --fast  # two  [max=1]\n",
      ),
    ).toBe("process");
    expect(shellDefaultName("./build.sh *\n./deploy.sh (staging|prod)")).toBe(
      defaultSatelliteName(),
    );
  });
});

describe("the guide printed once connected", () => {
  it("names the server and the satellite to select", () => {
    const text = uiGuide("http://localhost:5555", "jan@lab").join("\n");
    expect(text).toContain("http://localhost:5555");
    expect(text).toContain(
      'ⵗ → Configure agent → Connections → + New → MCP servers → "jan@lab" → Add to agent',
    );
  });
});

describe("a server that dies and comes back", () => {
  /**
   * TEST_SCENARIO: A replacement server whose tool list cannot be read is not
   * reachable by anything, so keeping it open leaks one child process per
   * attempt. The candidate is closed instead, and the failure is what the
   * worker retries on its backoff.
   */
  it("closes a replacement whose tool list cannot be read", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dam-satellite-child-"));
    const fixture = fileURLToPath(
      new URL("./fixtures/mcp-child.mjs", import.meta.url),
    );
    const backend = await createMcpBackend({
      kind: "stdio",
      command: process.execPath,
      args: [fixture, dir],
    });
    expect(backend.tools.map((tool) => tool.name)).toEqual(["greet"]);

    await vi.waitFor(
      async () => await expect(backend.ensureReady()).rejects.toThrow(),
      { timeout: 10_000 },
    );

    const pids = readFileSync(join(dir, "pids"), "utf8")
      .trim()
      .split("\n")
      .map((line) => Number.parseInt(line, 10));
    expect(pids.length, "the failed replacement was started").toBeGreaterThan(
      1,
    );
    const orphan = pids[1] as number;
    await vi.waitFor(
      () => expect(isRunning(orphan), "the orphaned child is gone").toBe(false),
      { timeout: 10_000 },
    );
    await backend.close();
  }, 20_000);
});

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
