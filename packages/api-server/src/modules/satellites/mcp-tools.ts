import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { commandArgvSchema, type SatelliteView } from "api-server-api";
import type { SatelliteAgentOpsImpl } from "./services/agent-ops.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Registers the four satellite tools on the platform
 * MCP server, and only for an Agent that holds at least one Satellite Grant.
 * The permitted commands travel in the tool description as the same usage lines
 * the Manifest is written in, not as a JSON Schema: a model reads one usage line
 * more reliably than a large anyOf, and the server matches every start against
 * the stored Snapshot anyway, so the description informs but never decides.
 */
export const DEFAULT_SATELLITE_WAIT_MS = 300_000;

interface ToolContent {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  [key: string]: unknown;
}

function json(value: unknown): ToolContent {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

async function run(fn: () => Promise<ToolContent>): Promise<ToolContent> {
  try {
    return await fn();
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: err instanceof Error ? err.message : String(err),
        },
      ],
      isError: true,
    };
  }
}

function describeSatellites(satellites: SatelliteView[]): string {
  return satellites
    .map((satellite) => {
      const header = [
        `## ${satellite.name}`,
        satellite.description ? ` — ${satellite.description}` : "",
        satellite.online ? "" : " (OFFLINE — starting a job will be refused)",
      ].join("");
      const commands = satellite.commands
        .map((command) => {
          const notes = [
            command.about,
            command.approval === "always"
              ? "needs your human's approval"
              : null,
          ].filter(Boolean);
          return `  ${command.run}${notes.length > 0 ? `\n      ${notes.join("; ")}` : ""}`;
        })
        .join("\n");
      return `${header}\n${commands}`;
    })
    .join("\n\n");
}

const GRAMMAR_NOTE = [
  "Each line below is a permitted command shape. Literals must match exactly;",
  "(a|b) is a closed choice; [x] is optional; (x)... repeats;",
  "* stands for one filename-like argument or part of one, ** for a path-like one,",
  "and ^…$ is a regex matching a whole argument.",
  "Anything not matching a line is refused — the refusal says which line came closest.",
].join(" ");

export function registerSatelliteTools(
  server: McpServer,
  deps: {
    ops: SatelliteAgentOpsImpl;
    agentId: string;
    satellites: SatelliteView[];
    waitDeadlineMs: number;
  },
): void {
  const names = deps.satellites.map((s) => s.name) as [string, ...string[]];

  server.tool(
    "start_satellite_job",
    [
      "Run an approved command on one of this agent's satellites — machines outside the platform that expose a fixed set of commands.",
      "Starts the job and returns immediately with a job reference; the result arrives later, and you will be woken with it when it finishes.",
      GRAMMAR_NOTE,
      "",
      describeSatellites(deps.satellites),
    ].join("\n"),
    {
      satellite: z.enum(names).describe("Which satellite to run on."),
      cmd: commandArgvSchema.describe(
        'The command as an argument list, exactly as it would be typed: ["./process.sh", "sales.db", "-n", "50"].',
      ),
    },
    ({ satellite, cmd }) =>
      run(async () => json(await deps.ops.start(deps.agentId, satellite, cmd))),
  );

  server.tool(
    "wait_for_satellite_job",
    "Block until a satellite job finishes. May return with status 'running' if it takes too long — just call this again.",
    {
      satellite: z.enum(names),
      job: z
        .number()
        .int()
        .positive()
        .describe("The job number, e.g. 7 for gpu-box#7."),
    },
    ({ satellite, job }) =>
      run(async () =>
        json(
          await deps.ops.wait(
            deps.agentId,
            satellite,
            job,
            deps.waitDeadlineMs,
          ),
        ),
      ),
  );

  server.tool(
    "get_satellite_job",
    "Read a satellite job's current state without waiting. Large output is written into your own workspace and reported as a path you can grep, tail or read.",
    { satellite: z.enum(names), job: z.number().int().positive() },
    ({ satellite, job }) =>
      run(async () => json(await deps.ops.read(deps.agentId, satellite, job))),
  );

  server.tool(
    "cancel_satellite_job",
    "Ask a satellite to stop a job. Cancellation is cooperative — a job already running may still finish.",
    { satellite: z.enum(names), job: z.number().int().positive() },
    ({ satellite, job }) =>
      run(async () =>
        json(await deps.ops.cancel(deps.agentId, satellite, job)),
      ),
  );
}
