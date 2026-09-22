import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  RESERVED_TOOL_NAMES,
  toolArgsSchema,
  type JobOutcome,
  type SatelliteTool,
  type SatelliteView,
} from "api-server-api";
import { isTerminal } from "./domain/types.js";
import type { SatelliteAgentOpsImpl } from "./services/agent-ops.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Re-exposes each granted Satellite's own tools on
 * the platform MCP server, plus the three job verbs that make a long call
 * survivable. Every name is scoped to its Satellite — `gpu_box__run`,
 * `gpu_box__wait` — so two machines offering a tool of the same name stay
 * distinct and the model never has to pass a satellite argument.
 *
 * The platform never reads inside a tool's `inputSchema`: only the machine knows
 * what its arguments mean, and it re-checks every call before it runs anything.
 * It does bound the arguments' size, since they are stored before anything on
 * the machine has seen them.
 *
 * A Satellite may not name a tool `wait`, `get` or `cancel` — the contract
 * refuses that at connect. A Snapshot stored before the rule, or one this
 * replica has not re-read, is still skipped rather than registered twice: a
 * duplicate registration fails the whole session, so one machine would take down
 * an Agent's entire tool surface. That guard spans every Satellite rather than
 * one, because a tool name may itself hold the scope separator: `gpu` offering
 * `box__run` and `gpu--box` offering `run` both render `gpu__box__run`.
 *
 * The default wait deadline sits under Node's own 300s request timeout, which
 * the harness server does not override. A wait running the full 300s would have
 * its socket torn down instead of answering "still running".
 */
export const DEFAULT_SATELLITE_WAIT_MS = 240_000;

const INLINE_WAIT_MS = 30_000;

interface ToolContent {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  [key: string]: unknown;
}

function json(value: unknown, isError = false): ToolContent {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
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

function outcomeContent(outcome: JobOutcome): ToolContent {
  return json(outcome, outcome.isError || outcome.status === "interrupted");
}

export function scopedName(satellite: string, tool: string): string {
  return `${satellite.replaceAll("-", "_")}__${tool}`;
}

function inputSchemaFor(tool: SatelliteTool): z.ZodType {
  try {
    return z.fromJSONSchema(tool.inputSchema as never) as z.ZodType;
  } catch {
    return z.looseObject({});
  }
}

function describe(satellite: SatelliteView, tool: SatelliteTool): string {
  const where = `Runs on ${satellite.name}${satellite.description === null ? "" : ` — ${satellite.description}`}, a machine outside the platform.`;
  const deferred = `The call returns the result if it finishes quickly, and otherwise a job reference; use ${scopedName(satellite.name, "wait")} to keep waiting, or ${scopedName(satellite.name, "get")} to check without waiting.`;
  const offline = satellite.online
    ? ""
    : `\n\n(${satellite.name} is OFFLINE — starting a job will be refused.)`;
  return `${[tool.description ?? tool.title ?? tool.name, "", where, deferred].join("\n")}${offline}`;
}

export function registerSatelliteTools(
  server: McpServer,
  deps: {
    ops: SatelliteAgentOpsImpl;
    agentId: string;
    satellites: SatelliteView[];
    waitDeadlineMs: number;
  },
): void {
  const taken = new Set<string>();
  const claim = (registered: string): boolean =>
    taken.has(registered) ? false : (taken.add(registered), true);

  for (const satellite of deps.satellites) {
    const name = satellite.name;
    for (const verb of RESERVED_TOOL_NAMES) claim(scopedName(name, verb));

    for (const tool of satellite.tools) {
      if (!claim(scopedName(name, tool.name))) continue;
      server.registerTool(
        scopedName(name, tool.name),
        {
          ...(tool.title === undefined ? {} : { title: tool.title }),
          description: describe(satellite, tool),
          inputSchema: inputSchemaFor(tool),
        },
        (args) =>
          run(async () => {
            const parsed = toolArgsSchema.safeParse(args ?? {});
            if (!parsed.success)
              return json(
                {
                  error: parsed.error.issues[0]?.message ?? "invalid arguments",
                },
                true,
              );
            const started = await deps.ops.start(
              deps.agentId,
              name,
              tool.name,
              parsed.data,
            );
            const settled = await deps.ops.wait(
              deps.agentId,
              name,
              started.sequence,
              INLINE_WAIT_MS,
            );
            return isTerminal(settled.status)
              ? outcomeContent(settled)
              : json({
                  ...started,
                  note: `still running — call ${scopedName(name, "wait")} with job ${started.sequence}, or ${scopedName(name, "get")} to check back later.`,
                });
          }),
      );
    }

    const jobArg = {
      job: z
        .number()
        .int()
        .positive()
        .describe(`The job number, e.g. 7 for ${name}#7.`),
    };

    server.tool(
      scopedName(name, "wait"),
      `Block until a job on ${name} finishes. May return with status 'running' if it takes too long — just call this again.`,
      jobArg,
      ({ job }) =>
        run(async () =>
          outcomeContent(
            await deps.ops.wait(deps.agentId, name, job, deps.waitDeadlineMs),
          ),
        ),
    );

    server.tool(
      scopedName(name, "get"),
      `Read a job on ${name} without waiting. Large output is written into your own workspace and reported as a path you can grep, tail or read.`,
      jobArg,
      ({ job }) =>
        run(async () =>
          outcomeContent(await deps.ops.read(deps.agentId, name, job)),
        ),
    );

    server.tool(
      scopedName(name, "cancel"),
      `Ask ${name} to stop a job. Cancellation is cooperative — a job already running may still finish.`,
      jobArg,
      ({ job }) =>
        run(async () =>
          outcomeContent(await deps.ops.cancel(deps.agentId, name, job)),
        ),
    );
  }
}
