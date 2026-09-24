import { hostname } from "node:os";
import { TRPCClientError } from "@trpc/client";
import { Command } from "commander";
import type { CompatService, ConfigService } from "../../cli/index.js";
import {
  EXIT_BELOW_FLOOR,
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";
import type { SatelliteBackend } from "../services/backend.js";
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

export function connectOptions(command: Command): Command {
  return command
    .requiredOption("--name <name>", "satellite name, as agents will see it")
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
  return resolveActiveHost(deps, {
    flag: opts.server ? { server: opts.server } : undefined,
    exitCodes: {
      runtimeFailure: EXIT_RUNTIME_FAILURE,
      belowFloor: EXIT_BELOW_FLOOR,
    },
  });
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
 * UNIT_BOUNDARY_DESCRIPTION: Runs a worker until it is told to stop, which is
 * the whole of what `mcp` and `commands` share once each has built its backend.
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
