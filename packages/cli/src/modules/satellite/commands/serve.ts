import { readFile } from "node:fs/promises";
import { hostname } from "node:os";
import { resolve } from "node:path";
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
import { parseManifest } from "../domain/manifest.js";
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

export function buildServeCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createTrpc: (host: string) => TrpcClient;
}): Command {
  return new Command("serve")
    .description(
      "Run this machine's satellite: poll for approved commands, run them, report back",
    )
    .argument("<manifest>", "path to the satellite manifest (TOML)")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .addHelpText(
      "after",
      "\nThe manifest decides what may run here — the platform can never widen it.\n" +
        "Reload it with SIGHUP. First interrupt drains, second kills running jobs.\n\n" +
        "Example:\n  dam satellite serve ./satellite.toml\n",
    )
    .action(async (path: string, opts: { server?: string }) => {
      const host = await resolveActiveHost(deps, {
        flag: opts.server ? { server: opts.server } : undefined,
        exitCodes: {
          runtimeFailure: EXIT_RUNTIME_FAILURE,
          belowFloor: EXIT_BELOW_FLOOR,
        },
      });

      const file = resolve(path);
      const load = async (): Promise<
        ReturnType<typeof parseManifest> extends infer R ? R : never
      > => parseManifest(await readFile(file, "utf8"));

      let parsed;
      try {
        parsed = await load();
      } catch (err) {
        process.stderr.write(`cannot read ${file}: ${String(err)}\n`);
        return process.exit(EXIT_INVALID_INPUT);
      }
      if (!parsed.ok) {
        process.stderr.write(`${file}: ${parsed.error}\n`);
        return process.exit(EXIT_INVALID_INPUT);
      }

      const log = {
        line: (text: string) =>
          process.stderr.write(`${new Date().toISOString()} ${text}\n`),
      };
      const worker = createWorker({
        manifest: parsed.value,
        transport: transportFor(deps.createTrpc(host)),
        log,
        host: hostname(),
      });

      process.on("SIGHUP", () => {
        void load()
          .then(async (next) => {
            if (!next.ok) {
              log.line(
                `reload rejected, keeping the running manifest: ${next.error}`,
              );
              return;
            }
            if (!worker.reload(next.value)) return;
            await transportFor(deps.createTrpc(host)).connect(
              next.value.pushed,
              hostname(),
            );
          })
          .catch((err: unknown) => log.line(`reload failed: ${String(err)}`));
      });

      let interrupted = false;
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

      try {
        await worker.start();
        process.exit(EXIT_SUCCESS);
      } catch (err) {
        process.stderr.write(`satellite stopped: ${String(err)}\n`);
        process.exit(EXIT_RUNTIME_FAILURE);
      }
    });
}
