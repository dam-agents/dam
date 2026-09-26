import { hostname, userInfo } from "node:os";
import { basename } from "node:path";
import { TRPCClientError } from "@trpc/client";
import { Command } from "commander";
import type { CompatService, ConfigService } from "../../cli/index.js";
import {
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";
import type { SatelliteBackend } from "../services/backend.js";
import type { McpServerSpec } from "../services/mcp-backend.js";
import {
  createWorker,
  SatelliteRemovedError,
  type WorkerTransport,
} from "../services/worker.js";

export interface ConnectDeps {
  compatService: CompatService;
  configService: ConfigService;
  createTrpc: (host: string) => TrpcClient;
}

export interface CommonConnectOpts {
  name?: string;
  description?: string;
  maxConcurrent?: number;
  server?: string;
}

export function connectOptions(command: Command, defaultHint: string): Command {
  return command
    .option(
      "--name <name>",
      `satellite name, as agents will see it (default: ${defaultHint})`,
    )
    .option("--description <text>", "what this machine is, shown to the agent")
    .option(
      "--max-concurrent <n>",
      "how many jobs may be in flight at once",
      (value: string) => Number.parseInt(value, 10),
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Folds any text into the name contract — lowercase,
 * with anything outside it turned into a dash — so an unusual login, hostname
 * or command still connects instead of failing on a name the user never typed.
 */
function asSatelliteName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9.@-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, 64);
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The name a Satellite takes when nothing about what
 * it serves suggests one: who is serving it, and from which machine.
 */
export function defaultSatelliteName(): string {
  return asSatelliteName(`${userInfo().username}@${hostname()}`);
}

const RUNNERS = new Set([
  "npx",
  "pnpx",
  "pnx",
  "bunx",
  "uvx",
  "pipx",
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "uv",
  "deno",
  "node",
  "python",
  "python3",
]);
const RUNNER_VERBS = new Set(["dlx", "exec", "run", "tool", "x"]);

/**
 * UNIT_BOUNDARY_DESCRIPTION: What a command line is "for", as a Satellite name.
 * A package runner or interpreter (`npx -y @acme/tool`, `uvx mcp-server-git`,
 * `python -m …`) names the thing it launches, not itself, so the first word
 * after it and its flags is taken; a scope, a version and a path or extension
 * are dropped so `@acme/tool@1.2` and `./bin/tool.sh` both become `tool`.
 * NOTE: A runner flag that takes a value (`npx -p pkg cmd`) is not understood;
 * the value is taken as the name. Pass --name for those.
 */
function programName(argv: readonly string[]): string | undefined {
  let at = 0;
  if (argv[0] !== undefined && RUNNERS.has(basename(argv[0]))) {
    at = 1;
    while (
      argv[at] !== undefined &&
      (argv[at]!.startsWith("-") || RUNNER_VERBS.has(argv[at]!))
    )
      at += 1;
  }
  const word = argv[at];
  if (word === undefined) return undefined;
  const bare = basename(
    word
      .replace(/^[a-z]+:/, "")
      .replace(/^@[^/]+\//, "")
      .replace(/(.)@[^@/]*$/, "$1"),
  );
  const name = asSatelliteName(bare.replace(/(.)\.[a-z0-9]+$/i, "$1"));
  return name === "" ? undefined : name;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The name an MCP Satellite takes when the user
 * gives none: the host it forwards to, or the server it starts.
 */
export function mcpDefaultName(spec: McpServerSpec): string {
  if (spec.kind === "url") return asSatelliteName(spec.url.hostname);
  return programName([spec.command, ...spec.args]) ?? defaultSatelliteName();
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The name a shell Satellite takes when the user
 * gives none: the one command it permits, when every pattern starts with the
 * same one, else who serves it from where. It reads the first word of each
 * pattern line rather than the parsed surface so the name is settled before
 * the surface, which carries it, is parsed.
 */
export function shellDefaultName(patterns: string): string {
  const programs = new Set(
    patterns
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"))
      .map((line) => line.split(/\s+/)[0]!),
  );
  const [only] = programs;
  return (
    (programs.size === 1 ? programName([only!]) : undefined) ??
    defaultSatelliteName()
  );
}

export const log = {
  line: (text: string): void => {
    process.stderr.write(`${new Date().toISOString()} ${text}\n`);
  },
};

export function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  return process.exit(EXIT_INVALID_INPUT);
}

export async function activeHost(
  deps: ConnectDeps,
  opts: CommonConnectOpts,
): Promise<string> {
  return resolveActiveHost(deps, opts.server);
}

function transportFor(trpc: TrpcClient): WorkerTransport {
  return {
    connect: (manifest, host) =>
      trpc.satellites.connect.mutate({ manifest, host }),
    claim: (input) =>
      trpc.satellites.claim.mutate(input).catch((err: unknown) => {
        if (
          err instanceof TRPCClientError &&
          (err.data as { code?: string } | undefined)?.code === "NOT_FOUND"
        )
          throw new SatelliteRemovedError(input.satellite);
        throw err;
      }),
    heartbeat: (input) => trpc.satellites.heartbeat.mutate(input),
    report: (input) => trpc.satellites.report.mutate(input),
    drain: (satellite) => trpc.satellites.drain.mutate(satellite),
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: What the user does next once the machine is
 * connected. A connected Satellite reaches no agent until someone adds it to
 * one in the UI, and nothing in the terminal would otherwise say so, so the
 * worker prints the path through the agent's settings right after it connects.
 */
export function uiGuide(host: string, name: string): string[] {
  return [
    `to give an agent these tools, open ${host}, pick the agent and go to`,
    `  ⵗ → Configure agent → Connections → + New → MCP servers → "${name}" → Add to agent`,
  ];
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Runs a worker until it is told to stop, which is
 * the whole of what `mcp` and `shell` share once each has built its backend.
 * The first interrupt drains so running jobs still report their outcome; the
 * second kills them, because a user who interrupts twice is not waiting.
 */
export async function serve(
  deps: ConnectDeps,
  opts: CommonConnectOpts,
  backend: SatelliteBackend,
  identity: { name: string; description?: string; maxConcurrent: number },
  startupLines: string[] = [],
): Promise<never> {
  const host = await activeHost(deps, opts);
  let interrupted = false;
  const worker = createWorker({
    name: identity.name,
    maxConcurrent: identity.maxConcurrent,
    ...(identity.description === undefined
      ? {}
      : { description: identity.description }),
    backend,
    transport: transportFor(deps.createTrpc(host)),
    log,
    host: hostname(),
    guide: uiGuide(host, identity.name),
  });

  const onInterrupt = (): void => {
    if (interrupted) {
      void worker.forceStop().finally(() => process.exit(EXIT_SUCCESS));
      return;
    }
    interrupted = true;
    void worker.drain();
  };
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onInterrupt);

  for (const line of startupLines) log.line(line);

  try {
    await worker.start();
    return process.exit(EXIT_SUCCESS);
  } catch (err) {
    process.stderr.write(`satellite stopped: ${String(err)}\n`);
    return process.exit(EXIT_RUNTIME_FAILURE);
  }
}

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
