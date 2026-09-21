import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MAX_JOB_OUTPUT_BYTES, type SatelliteTool } from "api-server-api";
import type { CallOutcome, SatelliteBackend } from "./backend.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: A Satellite backed by a stdio MCP server the user
 * names on the command line. The worker owns the child process, so the platform
 * still reaches nothing but the queue; what the tools mean is entirely the
 * server's business, and the platform never reads inside their schemas.
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

export async function createMcpBackend(
  spec: { command: string; args: string[]; cwd?: string },
  log: { line: (text: string) => void },
): Promise<SatelliteBackend> {
  const transport = new StdioClientTransport({
    command: spec.command,
    args: spec.args,
    cwd: spec.cwd,
    // The server inherits the worker's own environment, exactly as a Manifest
    // command does, so what the user exported when they started the worker is
    // what it sees.
    env: process.env as Record<string, string>,
    stderr: "inherit",
  });
  const client = new Client({ name: "dam-satellite", version: "1.0.0" });
  await client.connect(transport);

  const listed = await client.listTools();
  const tools: SatelliteTool[] = listed.tools.map((tool) => ({
    name: tool.name,
    ...(tool.title === undefined ? {} : { title: tool.title }),
    ...(tool.description === undefined
      ? {}
      : { description: tool.description.slice(0, 4096) }),
    inputSchema: tool.inputSchema as Record<string, unknown>,
  }));

  const inFlight = new Map<number, AbortController>();

  return {
    tools,

    async call(input): Promise<CallOutcome> {
      const controller = new AbortController();
      inFlight.set(input.sequence, controller);
      log.line(`START #${input.sequence}: ${input.tool}`);
      const startedAt = Date.now();
      try {
        const result = await client.callTool(
          { name: input.tool, arguments: input.args },
          undefined,
          { signal: controller.signal },
        );
        const { output, truncated } = renderContent(result);
        const elapsed = Math.round((Date.now() - startedAt) / 1000);
        log.line(
          `EXIT #${input.sequence}: ${result.isError === true ? "error" : "ok"} in ${elapsed}s`,
        );
        return {
          status: "done",
          isError: result.isError === true,
          exitCode: null,
          output,
          truncated,
        };
      } catch (err) {
        if (controller.signal.aborted) {
          log.line(`CANCEL #${input.sequence}`);
          return { status: "cancelled", output: "", truncated: false };
        }
        const reason = err instanceof Error ? err.message : String(err);
        log.line(`FAILED #${input.sequence}: ${reason}`);
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
