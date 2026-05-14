import { Command } from "commander";
import type { CompatService, ConfigService } from "../../cli/index.js";
import type { InstanceService } from "../services/instance-service.js";
import { createInstanceResolver } from "../services/instance-resolver.js";
import {
  describeConfigError,
  exitCodeForResolveError,
  formatTransportError,
  printCompatResolveError,
  printResolveError,
} from "./errors.js";
import { confirm } from "./prompt.js";
import {
  EXIT_INSTANCE_BELOW_FLOOR,
  EXIT_INSTANCE_INVALID_INPUT,
  EXIT_INSTANCE_RUNTIME_FAILURE,
  EXIT_INSTANCE_SUCCESS,
} from "./exit-codes.js";

export interface DeleteCommandDeps {
  compatService: CompatService;
  configService: ConfigService;
  createInstanceService: (host: string) => InstanceService;
  serverEnvVar: string;
}

interface CliOpts {
  server?: string;
  yes?: boolean;
  json?: boolean;
}

export function buildDeleteCommand(deps: DeleteCommandDeps): Command {
  return new Command("delete")
    .description("Delete an Instance and all its persistent data")
    .argument("<ref>", "Instance Ref — name or 'inst-…' ID")
    .option("--server <url>", "override the configured server URL for this call")
    .option("-y, --yes", "skip the confirmation prompt")
    .option("--json", "emit { deleted, id, name } or { cancelled: true } as JSON")
    .addHelpText(
      "after",
      "\nExamples:\n  dam instance delete my-agent\n  dam instance delete inst-abc123 --yes\n",
    )
    .action(async (ref: string, opts: CliOpts) => {
      await runDelete(ref, opts, deps);
    });
}

async function runDelete(ref: string, opts: CliOpts, deps: DeleteCommandDeps): Promise<void> {
  const flag = opts.server ? { server: opts.server } : undefined;

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

  if (!opts.yes) {
    if (!process.stdin.isTTY) {
      process.stderr.write(
        "error: delete requires confirmation; pass `--yes` or run interactively\n",
      );
      process.exit(EXIT_INSTANCE_INVALID_INPUT);
    }
    const proceed = await confirm(
      `Delete instance "${instance.name}"? This destroys all persistent data and cannot be undone.`,
    );
    if (!proceed) {
      if (opts.json) {
        process.stdout.write(`${JSON.stringify({ cancelled: true })}\n`);
      } else {
        process.stdout.write("Cancelled.\n");
      }
      process.exit(EXIT_INSTANCE_SUCCESS);
    }
  }

  const result = await svc.deleteAgent(instance.agentId);
  if (!result.ok) {
    if (result.error.kind === "not-found") {
      // Race: the agent vanished between resolve and delete. The
      // user's intent is satisfied — surface a success.
    } else if (result.error.kind === "auth-required") {
      process.stderr.write(`error: not authenticated: ${result.error.reason}\n`);
      process.stderr.write("hint: run `dam auth login` first\n");
      process.exit(EXIT_INSTANCE_RUNTIME_FAILURE);
    } else {
      process.stderr.write(`error: ${formatTransportError(result.error.reason, host)}\n`);
      process.exit(EXIT_INSTANCE_RUNTIME_FAILURE);
    }
  }

  if (opts.json) {
    process.stdout.write(
      `${JSON.stringify({ deleted: true, id: instance.id, name: instance.name })}\n`,
    );
  } else {
    process.stdout.write(`✓ Deleted instance "${instance.name}".\n`);
  }
  process.exit(EXIT_INSTANCE_SUCCESS);
}
