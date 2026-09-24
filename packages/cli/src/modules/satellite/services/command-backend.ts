import { spawn, type ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { MAX_JOB_OUTPUT_BYTES, type SatelliteTool } from "api-server-api";
import { localOracle, matchCommand } from "../domain/command-pattern.js";
import type {
  CommandSurface,
  LocalCommand,
} from "../domain/command-surface.js";
import type { CallOutcome, SatelliteBackend } from "./backend.js";

export const OUTPUT_CAP_BYTES = MAX_JOB_OUTPUT_BYTES;
export const RUN_TOOL = "run";

/**
 * UNIT_BOUNDARY_DESCRIPTION: A call this machine will not run, answered the way
 * any MCP server answers a tool call it rejects: a finished call whose result
 * is an error. The command never started, so the outcome is certain, and
 * `interrupted` — the outcome is unknowable — would say otherwise. The text
 * rides as output, which is not held to a reason's 280 characters, so a
 * refusal can name the pattern it came closest to in full.
 */
function refused(text: string): Promise<CallOutcome> {
  return Promise.resolve({
    status: "done",
    isError: true,
    exitCode: null,
    output: text,
    truncated: false,
    blocked: true,
  });
}

type KillReason = "cancel" | "timeout" | "shutdown";

interface RunningJob {
  child: ChildProcess;
  timer: NodeJS.Timeout | null;
  killedAs: KillReason | null;
  command: LocalCommand;
}

function describeTimeout(ms: number | undefined): string {
  if (ms === undefined) return "configured";
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  return `${Math.round(ms / 1000)}s`;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: A command is spawned in its own process group, so a
 * script that starts children can be stopped whole. Signalling the direct child
 * alone leaves those children running on the user's machine with nothing left to
 * report them.
 */
function signalGroup(entry: RunningJob, signal: NodeJS.Signals): void {
  const pid = entry.child.pid;
  if (pid === undefined) return;
  try {
    process.kill(-pid, signal);
  } catch {
    entry.child.kill(signal);
  }
}

export function describeSurface(surface: CommandSurface): string[] {
  return surface.commands.map(
    (command) =>
      `  ${command.run}` +
      (command.about === undefined ? "" : `\n      ${command.about}`),
  );
}

export function runTool(surface: CommandSurface): SatelliteTool {
  const lines = surface.commands.map(
    (command) =>
      `  ${command.run}` +
      (command.about === undefined ? "" : `\n      ${command.about}`),
  );
  return {
    name: RUN_TOOL,
    title: `Run an approved command on ${surface.pushed.name}`,
    description: [
      `Run one of the commands ${surface.pushed.name} permits.`,
      "Each line below is a permitted command shape. Literals must match exactly;",
      "(a|b) is a closed choice; [x] is optional; (x)... repeats;",
      "* stands for one filename-like argument or part of one, ** for a path-like one,",
      "and ^…$ is a regex matching a whole argument.",
      "Anything not matching a line is refused — the refusal says which line came closest.",
      "",
      ...lines,
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        cmd: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          description:
            'The command as an argument list, exactly as it would be typed: ["./process.sh", "sales.db", "-n", "50"].',
        },
      },
      required: ["cmd"],
      additionalProperties: false,
    },
  };
}

function resolveCommand(
  surface: CommandSurface,
  cmd: string[],
): LocalCommand | string {
  const matched = matchCommand(
    surface.commands.map((c) => c.parsed),
    cmd,
    localOracle,
  );
  if (!matched.ok)
    return matched.closest
      ? `${matched.reason}. Closest permitted command: ${matched.closest}`
      : matched.reason;
  return surface.commands[matched.index]!;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: A Command Surface served as a one-tool MCP server.
 * Its `run` tool takes the command, and this is where the allowlist is enforced
 * — the platform forwards the call without reading it, so nothing else checks.
 *
 * The permitted shapes ride in the tool description as the same usage lines the
 * user wrote, not as a JSON Schema: a model reads one usage line more reliably
 * than a large anyOf, and the machine re-matches every call anyway, so the
 * description informs but never decides.
 *
 * A per-command `max_concurrent` is counted here rather than at admission,
 * because the platform sees one tool and cannot tell two commands apart. The
 * ceiling: a refusal costs the Agent a turn where admission would have cost
 * nothing. The upgrade path is a tool per command, which the single-tool shape
 * rules out on purpose.
 */
export function createCommandBackend(
  surface: CommandSurface,
): SatelliteBackend {
  const running = new Map<number, RunningJob>();

  function call(input: {
    sequence: number;
    tool: string;
    args: Record<string, unknown>;
    approved: boolean;
  }): Promise<CallOutcome> {
    const { sequence, approved } = input;
    if (input.tool !== RUN_TOOL)
      return refused(`this satellite has no tool called "${input.tool}"`);

    const cmd = input.args.cmd;
    if (!Array.isArray(cmd) || cmd.some((a) => typeof a !== "string"))
      return refused("cmd must be an array of strings");
    const argv = cmd as string[];

    const command = resolveCommand(surface, argv);
    if (typeof command === "string")
      return refused(`refused locally: ${command}`);

    if (command.maxConcurrent !== undefined) {
      const active = [...running.values()].filter(
        (entry) => entry.command === command,
      ).length;
      if (active >= command.maxConcurrent)
        return refused(
          `${command.run} already has ${active} running (max ${command.maxConcurrent}) — wait for one to finish`,
        );
    }

    return spawnCommand(sequence, argv, command);
  }

  function spawnCommand(
    sequence: number,
    argv: string[],
    command: LocalCommand,
  ): Promise<CallOutcome> {
    const [program, ...args] = argv;
    const cwd = command.cwd ?? surface.cwd;
    const timeoutMs = command.timeoutMs ?? surface.timeoutMs;

    let output = "";
    let truncated = false;
    const append = (text: string): void => {
      if (truncated || text === "") return;
      const room = OUTPUT_CAP_BYTES - output.length;
      if (text.length > room) {
        output += text.slice(0, room);
        truncated = true;
        return;
      }
      output += text;
    };

    return new Promise<CallOutcome>((settle) => {
      const child = spawn(program!, args, {
        cwd,
        shell: false,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      for (const stream of [child.stdout, child.stderr]) {
        if (!stream) continue;
        const decoder = new StringDecoder("utf8");
        stream.on("data", (chunk: Buffer) => append(decoder.write(chunk)));
        stream.on("end", () => append(decoder.end()));
      }

      const entry: RunningJob = { child, timer: null, killedAs: null, command };
      if (timeoutMs !== undefined)
        entry.timer = setTimeout(() => {
          entry.killedAs = "timeout";
          signalGroup(entry, "SIGKILL");
        }, timeoutMs);
      running.set(sequence, entry);

      let done = false;
      const finish = (outcome: CallOutcome): void => {
        if (done) return;
        done = true;
        if (entry.timer) clearTimeout(entry.timer);
        running.delete(sequence);
        settle(outcome);
      };

      child.on("error", (err) => {
        finish({
          status: "done",
          isError: true,
          exitCode: null,
          output: [output, `could not start the command: ${err.message}`]
            .filter((part) => part !== "")
            .join("\n"),
          truncated,
        });
      });

      child.on("close", (code) => {
        if (entry.killedAs !== null) {
          finish(
            entry.killedAs === "cancel"
              ? { status: "cancelled", output, truncated }
              : {
                  status: "interrupted",
                  reason:
                    entry.killedAs === "timeout"
                      ? `stopped at its ${describeTimeout(timeoutMs)} timeout`
                      : "the satellite was stopped while this job was running",
                  output,
                  truncated,
                },
          );
          return;
        }
        const exitCode = code ?? 1;
        finish({
          status: "done",
          isError: exitCode !== 0,
          exitCode,
          output,
          truncated,
        });
      });
    });
  }

  return {
    get tools(): SatelliteTool[] {
      return [runTool(surface)];
    },
    call,
    describeCall: (_tool, args) =>
      Array.isArray(args.cmd) ? args.cmd.join(" ") : JSON.stringify(args),
    cancel(sequence: number): void {
      const entry = running.get(sequence);
      if (entry === undefined) return;
      entry.killedAs = "cancel";
      signalGroup(entry, "SIGTERM");
    },
    killAll(): void {
      for (const entry of running.values()) {
        entry.killedAs = "shutdown";
        signalGroup(entry, "SIGKILL");
        if (entry.timer) clearTimeout(entry.timer);
      }
    },
    close: () => Promise.resolve(),
  };
}
