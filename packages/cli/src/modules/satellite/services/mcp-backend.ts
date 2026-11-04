import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  MAX_JOB_IMAGES,
  MAX_JOB_OUTPUT_BYTES,
  SATELLITE_IMAGE_MIME_TYPES,
  escapedTextBytes,
  satelliteImageOf,
  satelliteToolSchema,
  storedPayloadBytes,
  type SatelliteImage,
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
 *
 * A result's images travel on unchanged, as the blocks the Agent's harness turns
 * back into pictures. Each is checked against the contract here first, so a
 * block the platform would refuse costs the Job its image rather than its whole
 * report, and the text and the images together are held to one ceiling. Each
 * image leaves a short marker in that text, so a harness that renders no image
 * blocks still shows that a picture came back. An image over any bound, or one
 * the contract will not take, is named there in full rather than vanishing from
 * a result that then looks empty. Images take their bytes first: text over the
 * inline limit reaches the Agent as a file anyway, where an image cannot.
 * Audio and embedded resources stay placeholders: no harness hands either to its
 * model, so passing them on would only cost bytes.
 */

interface McpContent {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

function kilobytes(bytes: number): string {
  return `${Math.round(bytes / 1024)} kB`;
}

function textFits(text: string, max: number): boolean {
  return escapedTextBytes(text) <= max;
}

function truncatedTo(text: string, max: number): string {
  if (textFits(text, max)) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (textFits(text.slice(0, middle), max)) low = middle;
    else high = middle - 1;
  }
  let cut = text.slice(0, low);
  while (cut !== "" && !textFits(cut, max)) cut = cut.slice(0, -1);
  return cut;
}

function renderContent(result: Record<string, unknown>): {
  output: string;
  truncated: boolean;
  images: SatelliteImage[];
} {
  const blocks = Array.isArray(result.content)
    ? (result.content as McpContent[])
    : [];
  const images: SatelliteImage[] = [];
  const kept = new Set<number>();
  const dropped: string[] = [];
  const textBudget = (candidate: readonly SatelliteImage[]): number =>
    MAX_JOB_OUTPUT_BYTES -
    storedPayloadBytes({ output: "", images: candidate });
  blocks.forEach((block, index) => {
    if (block.type !== "image") return;
    const image = satelliteImageOf(block);
    if (image === null) {
      dropped.push(
        `[image ${block.mimeType ?? "of an unknown type"} — not passed on: a satellite passes on base64 ${SATELLITE_IMAGE_MIME_TYPES.join(", ")} only]`,
      );
      return;
    }
    if (
      images.length === MAX_JOB_IMAGES ||
      textBudget([...images, image]) < 0
    ) {
      dropped.push(
        `[image ${image.mimeType}, ${kilobytes(image.data.length)} — not passed on: a satellite job carries at most ${MAX_JOB_IMAGES} images and ${MAX_JOB_OUTPUT_BYTES / 1024 / 1024} MiB between its text and them]`,
      );
      return;
    }
    images.push(image);
    kept.add(index);
  });
  const parts = blocks.map((block, index) => {
    if (block.type === "text" && typeof block.text === "string")
      return block.text;
    if (block.type === "image")
      return kept.has(index) ? `[image ${block.mimeType}]` : "";
    return `[${block.type}]`;
  });
  const structured =
    result.structuredContent === undefined
      ? ""
      : JSON.stringify(result.structuredContent, null, 2);
  const joined = [...dropped, ...parts, structured]
    .filter((part) => part !== "")
    .join("\n");
  const output = truncatedTo(joined, textBudget(images));
  return { output, truncated: output !== joined, images };
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
  let dead = false;
  let openedAt = Date.now();
  let client = await open();
  let tools = await listTools(client);

  async function open(): Promise<Client> {
    const started = await connectClient(spec);
    started.onclose = () => {
      dead = true;
    };
    openedAt = Date.now();
    return started;
  }

  async function listTools(from: Client): Promise<SatelliteTool[]> {
    const listed = await from.listTools();
    const collected: SatelliteTool[] = [];
    for (const tool of listed.tools) {
      const candidate = {
        name: tool.name,
        ...(tool.title === undefined
          ? {}
          : { title: tool.title.slice(0, 120) }),
        ...(tool.description === undefined
          ? {}
          : { description: tool.description.slice(0, 4096) }),
        inputSchema: tool.inputSchema as Record<string, unknown>,
      };
      const parsed = satelliteToolSchema.safeParse(candidate);
      if (!parsed.success) {
        await from.close().catch(() => {});
        throw new Error(
          `that MCP server's tool "${tool.name}" is not one a satellite can offer: ${parsed.error.issues[0]?.message ?? "invalid"}. Rename it on the server, or expose it through a different one.`,
        );
      }
      collected.push(parsed.data);
    }
    return collected;
  }
  const inFlight = new Map<number, AbortController>();

  return {
    get tools(): SatelliteTool[] {
      return tools;
    },

    /**
     * UNIT_BOUNDARY_DESCRIPTION: A replacement server is opened, listed and
     * only then published: a child whose tool list cannot be read is closed
     * rather than left running with no way to reach it, which would leak one
     * process per attempt. `livedMs` is how long the server that just exited
     * had been up, which is what tells a crash loop from a server that ran.
     */
    async ensureReady(): Promise<{ restarted: boolean; livedMs?: number }> {
      if (!dead) return { restarted: false };
      const livedMs = Date.now() - openedAt;
      const candidate = await open();
      let offered: SatelliteTool[];
      try {
        offered = await listTools(candidate);
      } catch (err) {
        await candidate.close().catch(() => {});
        throw err;
      }
      client = candidate;
      tools = offered;
      dead = false;
      return { restarted: true, livedMs };
    },
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
        const { output, truncated, images } = renderContent(result);
        return {
          status: "done",
          isError: result.isError === true,
          exitCode: null,
          output,
          images,
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
