import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  MAX_JOB_OUTPUT_BYTES,
  satelliteToolSchema,
  type SatelliteTool,
} from "api-server-api";
import type { CallOutcome, SatelliteBackend } from "./backend.js";
import { errorMessage } from "../../shared/error-message.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: A Satellite backed by an MCP server the user names
 * on the command line: either one the worker starts over stdio, or one already
 * listening that the worker reaches by URL. Either way the worker is the only
 * MCP client, so the platform still reaches nothing but the queue; what the
 * tools mean is entirely the server's business, and the platform never reads
 * inside their schemas.
 *
 * A started server inherits the worker's own environment, exactly as a Command
 * Surface command does, so what the user exported when they started the worker
 * is what it sees. A server reached by URL is tried over Streamable HTTP first
 * and over the older SSE transport when that fails, since servers in the wild
 * still speak either.
 *
 * Every listed tool is parsed against the contract's own schema here rather than
 * forwarded: a name the platform reserves, one that is too long, or one holding
 * a character the contract refuses would otherwise surface as a schema error
 * about someone else's server. Catching it at the machine turns that into a
 * sentence naming the tool the user has to rename. Title and description are
 * trimmed to their caps instead — a wordy title is not a reason to refuse a
 * machine, where a name the platform cannot register is.
 */

interface McpContent {
  type: string;
  text?: string;
}

function renderContent(result: Record<string, unknown>): {
  output: string;
  truncated: boolean;
} {
  const blocks = Array.isArray(result.content)
    ? (result.content as McpContent[])
    : [];
  const text = blocks
    .map((block) =>
      block.type === "text" && typeof block.text === "string"
        ? block.text
        : `[${block.type}]`,
    )
    .join("\n");
  const structured =
    result.structuredContent === undefined
      ? ""
      : JSON.stringify(result.structuredContent, null, 2);
  const joined = [text, structured].filter((part) => part !== "").join("\n");
  return joined.length > MAX_JOB_OUTPUT_BYTES
    ? { output: joined.slice(0, MAX_JOB_OUTPUT_BYTES), truncated: true }
    : { output: joined, truncated: false };
}

export type McpServerSpec =
  | { kind: "stdio"; command: string; args: string[]; cwd?: string }
  | { kind: "url"; url: URL; headers: Record<string, string> };

const CLIENT_INFO = { name: "satellite", version: "1.0.0" };

async function connectClient(spec: McpServerSpec): Promise<Client> {
  if (spec.kind === "stdio") {
    const client = new Client(CLIENT_INFO);
    await client.connect(
      new StdioClientTransport({
        command: spec.command,
        args: spec.args,
        cwd: spec.cwd,
        env: process.env as Record<string, string>,
        stderr: "inherit",
      }),
    );
    return client;
  }
  const requestInit = { headers: spec.headers };
  try {
    const client = new Client(CLIENT_INFO);
    await client.connect(
      new StreamableHTTPClientTransport(spec.url, { requestInit }),
    );
    return client;
  } catch (streamableError) {
    const client = new Client(CLIENT_INFO);
    try {
      await client.connect(new SSEClientTransport(spec.url, { requestInit }));
      return client;
    } catch {
      throw streamableError;
    }
  }
}

export async function createMcpBackend(
  spec: McpServerSpec,
): Promise<SatelliteBackend> {
  const client = await connectClient(spec);

  const listed = await client.listTools();
  const tools: SatelliteTool[] = [];
  for (const tool of listed.tools) {
    const candidate = {
      name: tool.name,
      ...(tool.title === undefined ? {} : { title: tool.title.slice(0, 120) }),
      ...(tool.description === undefined
        ? {}
        : { description: tool.description.slice(0, 4096) }),
      inputSchema: tool.inputSchema as Record<string, unknown>,
    };
    const parsed = satelliteToolSchema.safeParse(candidate);
    if (!parsed.success) {
      await client.close().catch(() => {});
      throw new Error(
        `that MCP server's tool "${tool.name}" is not one a satellite can offer: ${parsed.error.issues[0]?.message ?? "invalid"}. Rename it on the server, or expose it through a different one.`,
      );
    }
    tools.push(parsed.data);
  }
  const inFlight = new Map<number, AbortController>();

  return {
    tools,

    describeCall(tool, args) {
      const text = `${tool} ${JSON.stringify(args)}`;
      return text.length > 200 ? `${text.slice(0, 199)}…` : text;
    },

    async call(input): Promise<CallOutcome> {
      const controller = new AbortController();
      inFlight.set(input.sequence, controller);
      try {
        const result = await client.callTool(
          { name: input.tool, arguments: input.args },
          undefined,
          { signal: controller.signal },
        );
        const { output, truncated } = renderContent(result);
        return {
          status: "done",
          isError: result.isError === true,
          exitCode: null,
          output,
          truncated,
        };
      } catch (err) {
        if (controller.signal.aborted)
          return { status: "cancelled", output: "", truncated: false };
        const reason = errorMessage(err);
        return {
          status: "interrupted",
          reason: reason.slice(0, 280),
          output: "",
          truncated: false,
        };
      } finally {
        inFlight.delete(input.sequence);
      }
    },

    cancel(sequence: number): void {
      inFlight.get(sequence)?.abort();
    },

    killAll(): void {
      for (const controller of inFlight.values()) controller.abort();
    },

    close: () => client.close(),
  };
}
