import { readFile } from "node:fs/promises";
import { hostname } from "node:os";
import { resolve } from "node:path";
import { Command } from "commander";
import { DEFAULT_MAX_CONCURRENT, satelliteNameSchema } from "api-server-api";
import type { CompatService, ConfigService } from "../../cli/index.js";
import {
  EXIT_BELOW_FLOOR,
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";
import { parseManifest, type LocalManifest } from "../domain/manifest.js";
import type { SatelliteBackend } from "../services/backend.js";
import {
  createCommandBackend,
  describeManifest,
  runTool,
} from "../services/command-backend.js";
import { createMcpBackend } from "../services/mcp-backend.js";
import { createWorker, type WorkerTransport } from "../services/worker.js";

function transportFor(trpc: TrpcClient): WorkerTransport {
  return {
    connect: (manifest, host) =>
      trpc.satellites.connect.mutate({ manifest, host }),
    claim: (input) => trpc.satellites.claim.mutate(input),
    heartbeat: (input) => trpc.satellites.heartbeat.mutate(input),
    report: (input) => trpc.satellites.report.mutate(input),
    drain: (satellite) => trpc.satellites.drain.mutate(satellite),
  };
}

export function buildConnectCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createTrpc: (host: string) => TrpcClient;
}): Command {
  return new Command("connect")
    .description(
      "Connect this machine as a satellite: expose a manifest or a stdio MCP server to the agents you grant it to",
    )
    .argument(
      "[target...]",
      "path to the satellite manifest (TOML), or — with --name — the stdio MCP server to run",
    )
    .option(
      "--name <name>",
      "satellite name; giving it selects the MCP-server form, and every argument is then the command",
    )
    .option("--description <text>", "what this machine is, shown to the agent")
    .option(
      "--max-concurrent <n>",
      "how many jobs may be in flight at once (MCP server form)",
      (value: string) => Number.parseInt(value, 10),
    )
    .option("--cwd <dir>", "working directory for the MCP server")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .addHelpText(
      "after",
      "\nA satellite is an MCP server this machine exposes to your agents. Either\n" +
        "form works, and the platform cannot tell them apart:\n\n" +
        "  dam satellite connect ./satellite.toml\n" +
        "      The manifest decides what may run here — the platform can never\n" +
        "      widen it. It becomes a one-tool MCP server whose tool takes the\n" +
        "      command to run. Reload it with SIGHUP — a manifest that does not\n" +
        "      parse, that renames the satellite, or that arrives while draining\n" +
        "      is refused, and so is one whose push fails; the running manifest\n" +
        "      is kept in every case.\n\n" +
        "  dam satellite connect --name gpu-box -- npx -y @acme/build-mcp\n" +
        "      Runs the MCP server and offers its tools verbatim. The server\n" +
        "      inherits this shell's environment.\n\n" +
        "First interrupt drains, second kills running jobs.\n",
    )
    .action(
      async (
        target: string[],
        opts: {
          name?: string;
          description?: string;
          maxConcurrent?: number;
          cwd?: string;
          server?: string;
        },
      ) => {
        const host = await resolveActiveHost(deps, {
          flag: opts.server ? { server: opts.server } : undefined,
          exitCodes: {
            runtimeFailure: EXIT_RUNTIME_FAILURE,
            belowFloor: EXIT_BELOW_FLOOR,
          },
        });

        const fail = (message: string): never => {
          process.stderr.write(`${message}\n`);
          return process.exit(EXIT_INVALID_INPUT);
        };

        let backend: SatelliteBackend;
        let reloadable: {
          refusesReload(next: LocalManifest): string | null;
          reload(next: LocalManifest): void;
        } | null = null;
        let name: string;
        let maxConcurrent: number;
        let description: string | undefined;
        let manifestFile: string | null = null;
        let startupLines: string[] = [];

        const log = {
          line: (text: string) =>
            process.stderr.write(`${new Date().toISOString()} ${text}\n`),
        };

        if (opts.name !== undefined) {
          const parsedName = satelliteNameSchema.safeParse(opts.name);
          if (!parsedName.success)
            return fail(
              `--name: ${parsedName.error.issues[0]?.message ?? "invalid"}`,
            );
          if (target.length === 0)
            return fail("--name needs the MCP server to run, after --");
          name = opts.name;
          maxConcurrent = opts.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
          description = opts.description;
          try {
            backend = await createMcpBackend(
              {
                command: target[0]!,
                args: target.slice(1),
                ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }),
              },
              log,
            );
          } catch (err) {
            return fail(`could not start the MCP server: ${String(err)}`);
          }
          if (backend.tools.length === 0) {
            await backend.close().catch(() => {});
            return fail("that MCP server lists no tools — nothing to expose");
          }
        } else {
          if (target.length !== 1)
            return fail(
              "give one manifest path, or --name and the MCP server to run",
            );
          manifestFile = resolve(target[0]!);
          let parsed;
          try {
            parsed = parseManifest(await readFile(manifestFile, "utf8"));
          } catch (err) {
            return fail(`cannot read ${manifestFile}: ${String(err)}`);
          }
          if (!parsed.ok) return fail(`${manifestFile}: ${parsed.error}`);
          const commandBackend = createCommandBackend(parsed.value, log);
          backend = commandBackend;
          reloadable = commandBackend;
          name = parsed.value.pushed.name;
          maxConcurrent = parsed.value.pushed.maxConcurrent;
          description = parsed.value.pushed.description;
          startupLines = describeManifest(parsed.value);
        }

        let interrupted = false;
        const worker = createWorker({
          name,
          maxConcurrent,
          ...(description === undefined ? {} : { description }),
          backend,
          transport: transportFor(deps.createTrpc(host)),
          log,
          host: hostname(),
        });

        if (manifestFile !== null && reloadable !== null) {
          const file = manifestFile;
          const reload = reloadable;
          process.on("SIGHUP", () => {
            void readFile(file, "utf8")
              .then(async (text) => {
                const next = parseManifest(text);
                if (!next.ok) {
                  log.line(
                    `reload rejected, keeping the running manifest: ${next.error}`,
                  );
                  return;
                }
                if (interrupted) {
                  log.line("reload ignored: this satellite is draining");
                  return;
                }
                const refusal = reload.refusesReload(next.value);
                if (refusal !== null) {
                  log.line(`reload rejected: ${refusal}`);
                  return;
                }
                await worker.push([runTool(next.value)]);
                reload.reload(next.value);
                log.line("reload applied — permitted commands:");
                for (const line of describeManifest(next.value)) log.line(line);
              })
              .catch((err: unknown) =>
                log.line(
                  `reload failed, keeping the running manifest: ${String(err)}`,
                ),
              );
          });
        }

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

        if (manifestFile !== null) {
          log.line("permitted commands:");
          for (const line of startupLines) log.line(line);
        }

        try {
          await worker.start();
          process.exit(EXIT_SUCCESS);
        } catch (err) {
          process.stderr.write(`satellite stopped: ${String(err)}\n`);
          process.exit(EXIT_RUNTIME_FAILURE);
        }
      },
    );
}
