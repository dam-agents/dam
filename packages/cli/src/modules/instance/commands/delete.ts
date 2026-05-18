import { Command } from "commander";
import type { CompatService, ConfigService } from "../../cli/index.js";
import type { InstanceService } from "../services/instance-service.js";
import { createInstanceResolver } from "../services/instance-resolver.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import {
  exitCodeForResolveError,
  printResolveError,
  printServiceError,
} from "./errors.js";
import { confirm } from "../../shared/prompt.js";
import {
  EXIT_INSTANCE_BELOW_FLOOR,
  EXIT_INSTANCE_INVALID_INPUT,
  EXIT_INSTANCE_RUNTIME_FAILURE,
  EXIT_INSTANCE_SUCCESS,
} from "./exit-codes.js";

export function buildDeleteCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createInstanceService: (host: string) => InstanceService;
}): Command {
  return new Command("delete")
    .description("Delete an Instance and all its persistent data")
    .argument("<ref>", "Instance Ref — name or 'inst-…' ID")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("-y, --yes", "skip the confirmation prompt")
    .option(
      "--json",
      "emit { deleted, id, name } or { cancelled: true } as JSON",
    )
    .addHelpText(
      "after",
      "\nExamples:\n  dam instance delete my-agent\n  dam instance delete inst-abc123 --yes\n",
    )
    .action(
      async (
        ref: string,
        opts: { server?: string; yes?: boolean; json?: boolean },
      ) => {
        await runDelete(ref, opts, deps);
      },
    );
}

type DeleteDeps = Parameters<typeof buildDeleteCommand>[0];

async function runDelete(
  ref: string,
  opts: { server?: string; yes?: boolean; json?: boolean },
  deps: DeleteDeps,
): Promise<void> {
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

  // Orphaned instances (no backing agent) need a direct delete since the cascade can't fire.
  const orphan = instance.templateId === null;
  const result = orphan
    ? await svc.deleteInstance(instance.id)
    : await svc.deleteAgent(instance.agentId);
  let alreadyGone = false;
  if (!result.ok) {
    if (result.error.kind === "not-found") {
      alreadyGone = true;
    } else {
      printServiceError(result.error, host);
      process.exit(EXIT_INSTANCE_RUNTIME_FAILURE);
    }
  }

  if (opts.json) {
    process.stdout.write(
      `${JSON.stringify({
        deleted: true,
        id: instance.id,
        name: instance.name,
        alreadyGone,
        orphan,
      })}\n`,
    );
  } else if (alreadyGone) {
    process.stdout.write(
      `✓ Deleted instance "${instance.name}" (was already gone).\n`,
    );
  } else if (orphan) {
    process.stdout.write(
      `✓ Deleted orphaned instance "${instance.name}" (no backing agent).\n`,
    );
  } else {
    process.stdout.write(`✓ Deleted instance "${instance.name}".\n`);
  }
  process.exit(EXIT_INSTANCE_SUCCESS);
}
