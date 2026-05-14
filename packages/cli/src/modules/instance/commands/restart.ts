import { Command } from "commander";
import type { Instance } from "api-server-api";
import type { CompatService, ConfigService } from "../../cli/index.js";
import type { InstanceService } from "../services/instance-service.js";
import { createInstanceResolver } from "../services/instance-resolver.js";
import { fetchOrFallback } from "../services/fetch-or-fallback.js";
import { waitForRunning } from "../services/wait-for-state.js";
import {
  describeConfigError,
  exitCodeForResolveError,
  formatTransportError,
  printCompatResolveError,
  printResolveError,
} from "./errors.js";
import {
  EXIT_INSTANCE_BELOW_FLOOR,
  EXIT_INSTANCE_INVALID_INPUT,
  EXIT_INSTANCE_RUNTIME_FAILURE,
  EXIT_INSTANCE_SUCCESS,
  EXIT_INSTANCE_NOT_RESOLVED,
} from "./exit-codes.js";

const DEFAULT_TIMEOUT_SECONDS = 120;
/** Grace period before the first poll. Without this, the first poll can
 *  observe stale `currentState === "running"` from the pod we just told
 *  the controller to delete. Locked at 2 s in spec §4.6. */
const RESTART_GRACE_SECONDS = 2;

export interface RestartCommandDeps {
  compatService: CompatService;
  configService: ConfigService;
  createInstanceService: (host: string) => InstanceService;
  serverEnvVar: string;
}

interface CliOpts {
  server?: string;
  wait?: boolean;
  timeout?: string;
  json?: boolean;
}

export function buildRestartCommand(deps: RestartCommandDeps): Command {
  return new Command("restart")
    .description("Restart an Instance (recreates the pod; persistent volumes survive)")
    .argument("<ref>", "Instance Ref — name or 'inst-…' ID")
    .option("--server <url>", "override the configured server URL for this call")
    .option("--wait", "poll until state == `running` (or terminal error)")
    .option(
      "--timeout <seconds>",
      `--wait timeout in seconds (default ${DEFAULT_TIMEOUT_SECONDS})`,
    )
    .option("--json", "emit raw Instance JSON")
    .addHelpText(
      "after",
      "\nExamples:\n  dam instance restart my-agent\n  dam instance restart my-agent --wait\n",
    )
    .action(async (ref: string, opts: CliOpts) => {
      await runRestart(ref, opts, deps);
    });
}

async function runRestart(ref: string, opts: CliOpts, deps: RestartCommandDeps): Promise<void> {
  const flag = opts.server ? { server: opts.server } : undefined;

  const timeoutSeconds = parseTimeout(opts.timeout);
  if (timeoutSeconds === null) {
    process.stderr.write(
      `error: invalid \`--timeout\` value \`${opts.timeout}\`; expected positive integer\n`,
    );
    process.exit(EXIT_INSTANCE_INVALID_INPUT);
  }

  const compat = await deps.compatService.check({ flag });
  if (!compat.ok) {
    printCompatResolveError(compat.error, deps.serverEnvVar);
    process.exit(EXIT_INSTANCE_RUNTIME_FAILURE);
  }
  const verdict = compat.value;
  if (verdict.kind === "below-floor") {
    process.stderr.write(
      `error: CLI ${verdict.localCli} is below the server's minimum required version ${verdict.serverMinClient}; upgrade and retry\n`,
    );
    process.exit(EXIT_INSTANCE_BELOW_FLOOR);
  }
  if (verdict.kind === "behind-current") {
    process.stderr.write(
      `warning: CLI ${verdict.localCli} is behind server ${verdict.serverVersion}; consider upgrading\n`,
    );
  }

  const cfg = await deps.configService.getResolved({ flag });
  if (!cfg.ok) {
    process.stderr.write(`error: ${describeConfigError(cfg.error)}\n`);
    process.exit(EXIT_INSTANCE_RUNTIME_FAILURE);
  }
  const host = cfg.value.server;

  const svc = deps.createInstanceService(host);
  const resolver = createInstanceResolver({ instanceService: svc });
  const resolved = await resolver.resolve(ref);
  if (!resolved.ok) {
    printResolveError(resolved.error, host);
    process.exit(exitCodeForResolveError(resolved.error));
  }
  const instance = resolved.value;

  const restartResult = await svc.restart(instance.id);
  if (!restartResult.ok) {
    if (restartResult.error.kind === "not-found") {
      // Race: the instance vanished between resolve and restart.
      process.stderr.write(`error: no instance with id \`${instance.id}\`\n`);
      process.exit(EXIT_INSTANCE_NOT_RESOLVED);
    }
    if (restartResult.error.kind === "auth-required") {
      process.stderr.write(`error: not authenticated: ${restartResult.error.reason}\n`);
      process.stderr.write("hint: run `dam auth login` first\n");
      process.exit(EXIT_INSTANCE_RUNTIME_FAILURE);
    }
    process.stderr.write(`error: ${formatTransportError(restartResult.error.reason, host)}\n`);
    process.exit(EXIT_INSTANCE_RUNTIME_FAILURE);
  }

  // `finalInstance` carries the post-restart snapshot through to the
  // output stage. On `--wait`, the ready branch already produced one —
  // reusing it avoids a second `svc.get()` round-trip.
  let finalInstance: Instance | undefined;
  if (opts.wait) {
    let firstStateSeen = false;
    const waitResult = await waitForRunning(svc, instance.id, {
      timeoutSeconds,
      graceSeconds: RESTART_GRACE_SECONDS,
      onStateChange: (state) => {
        if (opts.json) return;
        if (!firstStateSeen) {
          process.stderr.write(`Waiting for "${instance.name}"… state: ${state}\n`);
          firstStateSeen = true;
        } else {
          process.stderr.write(`state: ${state}\n`);
        }
      },
    });

    switch (waitResult.kind) {
      case "ready":
        finalInstance = waitResult.instance;
        break;
      case "error":
        if (opts.json) {
          process.stdout.write(`${JSON.stringify(waitResult.instance)}\n`);
        } else {
          const reason = waitResult.instance.error ?? "unknown";
          process.stderr.write(
            `error: instance "${instance.name}" entered error state: ${reason}\n`,
          );
        }
        process.exit(EXIT_INSTANCE_RUNTIME_FAILURE);
        return;
      case "timeout":
        if (opts.json) {
          // Best-effort refresh so the JSON payload reflects the latest
          // state. If the refresh fails, fall back to the pre-restart
          // snapshot — scripts always get a valid Instance, never empty
          // stdout.
          process.stdout.write(
            `${JSON.stringify(await fetchOrFallback(svc, instance, "after restart"))}\n`,
          );
        } else {
          process.stderr.write(
            `error: timed out waiting for "${instance.name}" to reach running (current: ${waitResult.lastState})\n`,
          );
        }
        process.exit(EXIT_INSTANCE_RUNTIME_FAILURE);
        return;
      case "transport":
        process.stderr.write(`error: ${formatTransportError(waitResult.reason, host)}\n`);
        process.exit(EXIT_INSTANCE_RUNTIME_FAILURE);
        return;
    }
  }

  if (opts.json) {
    // Non-wait path needs a refresh to surface the post-restart state.
    // Wait+ready already populated `finalInstance` above.
    const payload = finalInstance ?? (await fetchOrFallback(svc, instance, "after restart"));
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } else {
    const tail = finalInstance ? ` State: ${finalInstance.state}.` : "";
    process.stdout.write(`✓ Restarted instance "${instance.name}" (${instance.id}).${tail}\n`);
  }
  process.exit(EXIT_INSTANCE_SUCCESS);
}

function parseTimeout(raw: string | undefined): number | null {
  if (raw === undefined) return DEFAULT_TIMEOUT_SECONDS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}
