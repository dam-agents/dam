import { Command } from "commander";
import type { Instance } from "api-server-api";
import type { CompatService, ConfigService } from "../../cli/index.js";
import type { InstanceService } from "../services/instance-service.js";
import { createInstanceResolver } from "../services/instance-resolver.js";
import { fetchOrFallback } from "../services/fetch-or-fallback.js";
import { waitForRunning } from "../services/wait-for-state.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { parseTimeout } from "../../shared/parse-timeout.js";
import {
  exitCodeForResolveError,
  formatTransportError,
  printResolveError,
  printServiceError,
} from "./errors.js";
import {
  EXIT_INSTANCE_BELOW_FLOOR,
  EXIT_INSTANCE_INVALID_INPUT,
  EXIT_INSTANCE_RUNTIME_FAILURE,
  EXIT_INSTANCE_SUCCESS,
  EXIT_INSTANCE_NOT_RESOLVED,
} from "./exit-codes.js";

const DEFAULT_TIMEOUT_SECONDS = 120;
// Grace before first poll so the controller observes pod deletion before we see stale "running".
const RESTART_GRACE_SECONDS = 2;

export function buildRestartCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createInstanceService: (host: string) => InstanceService;
}): Command {
  return new Command("restart")
    .description(
      "Restart an Instance (recreates the pod; persistent volumes survive)",
    )
    .argument("<ref>", "Instance Ref — name or 'inst-…' ID")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
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
    .action(
      async (
        ref: string,
        opts: {
          server?: string;
          wait?: boolean;
          timeout?: string;
          json?: boolean;
        },
      ) => {
        await runRestart(ref, opts, deps);
      },
    );
}

type RestartDeps = Parameters<typeof buildRestartCommand>[0];

async function runRestart(
  ref: string,
  opts: { server?: string; wait?: boolean; timeout?: string; json?: boolean },
  deps: RestartDeps,
): Promise<void> {
  const timeoutSeconds = parseTimeout(opts.timeout, DEFAULT_TIMEOUT_SECONDS);
  if (timeoutSeconds === null) {
    process.stderr.write(
      `error: invalid \`--timeout\` value \`${opts.timeout}\`; expected positive integer\n`,
    );
    process.exit(EXIT_INSTANCE_INVALID_INPUT);
  }

  const host = await resolveActiveHost(deps, {
    flag: opts.server ? { server: opts.server } : undefined,
    exitCodes: {
      runtimeFailure: EXIT_INSTANCE_RUNTIME_FAILURE,
      belowFloor: EXIT_INSTANCE_BELOW_FLOOR,
    },
  });

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
      process.stderr.write(`error: no instance with id \`${instance.id}\`\n`);
      process.exit(EXIT_INSTANCE_NOT_RESOLVED);
    }
    printServiceError(restartResult.error, host);
    process.exit(EXIT_INSTANCE_RUNTIME_FAILURE);
  }

  let finalInstance: Instance | undefined;
  if (opts.wait) {
    let firstStateSeen = false;
    const waitResult = await waitForRunning(svc, instance.id, {
      timeoutSeconds,
      graceSeconds: RESTART_GRACE_SECONDS,
      onStateChange: (state) => {
        if (opts.json) return;
        if (!firstStateSeen) {
          process.stderr.write(
            `Waiting for "${instance.name}"… state: ${state}\n`,
          );
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
        process.stderr.write(
          `error: ${formatTransportError(waitResult.reason, host)}\n`,
        );
        process.exit(EXIT_INSTANCE_RUNTIME_FAILURE);
        return;
    }
  }

  if (opts.json) {
    const payload =
      finalInstance ?? (await fetchOrFallback(svc, instance, "after restart"));
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } else {
    const tail = finalInstance ? ` State: ${finalInstance.state}.` : "";
    process.stdout.write(
      `✓ Restarted instance "${instance.name}" (${instance.id}).${tail}\n`,
    );
  }
  process.exit(EXIT_INSTANCE_SUCCESS);
}
