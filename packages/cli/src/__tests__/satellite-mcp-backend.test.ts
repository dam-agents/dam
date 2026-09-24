import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { satelliteNameSchema } from "api-server-api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
 * credentials. They also pin how a --url is read, the name a Satellite takes
 * when given none, and the guide the worker prints once connected.
 */

let server: Server;
let base: string;
const seenHeaders: IncomingHttpHeaders[] = [];

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
        "fail",
        "greet",
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
      'Configure agent → Connections → + New → MCP servers → "jan@lab" → Add to agent',
    );
  });
});
