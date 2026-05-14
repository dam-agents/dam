import { cancel, intro, isCancel, note, outro, select, spinner, text } from "@clack/prompts";
import { Command } from "commander";
import type { Instance } from "api-server-api";
import type { CompatService, ConfigService } from "../../cli/index.js";
import type { InstanceService } from "../../instance/index.js";
import { validateInstanceName } from "../../instance/commands/create-helpers.js";
import {
  describeConfigError,
  formatTransportError,
  printCompatResolveError,
} from "../../instance/commands/errors.js";
import {
  EXIT_INSTANCE_BELOW_FLOOR,
  EXIT_INSTANCE_RUNTIME_FAILURE,
  EXIT_INSTANCE_SUCCESS,
} from "../../instance/commands/exit-codes.js";
import { waitForRunning } from "../../instance/services/wait-for-state.js";
import type { TemplateService } from "../../template/index.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";

const WAIT_TIMEOUT_SECONDS = 120;

/**
 * Deps for `dam agent create`. Mirrors `dam instance create`'s shape so
 * the orchestration verbs added in issues 004–006 can drop in without
 * widening the interface.
 */
export interface CreateAgentCommandDeps {
  compatService: CompatService;
  configService: ConfigService;
  createInstanceService: (host: string) => InstanceService;
  createTemplateService: (host: string) => TemplateService;
  createTrpcClient: (host: string) => TrpcClient;
  serverEnvVar: string;
}

interface CliOpts {
  server?: string;
}

export function buildCreateCommand(deps: CreateAgentCommandDeps): Command {
  return new Command("create")
    .description("Interactively create an agent and a running instance")
    .option("--server <url>", "override the configured server URL for this call")
    .action(async (opts: CliOpts) => {
      await runCreate(opts, deps);
    });
}

async function runCreate(opts: CliOpts, deps: CreateAgentCommandDeps): Promise<void> {
  if (!process.stdin.isTTY) {
    process.stderr.write(
      "error: dam agent create requires an interactive terminal; use `dam instance create` for scripted setup\n",
    );
    process.exit(1);
  }

  intro("dam agent create");

  const flag = opts.server ? { server: opts.server } : undefined;

  // --- Compat pre-flight ----------------------------------------------
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

  // --- Step 1: name --------------------------------------------------
  const name = await text({
    message: "Agent name",
    placeholder: "my-agent",
    validate(value) {
      const check = validateInstanceName(value ?? "");
      if (check.ok) return undefined;
      if (check.error === "reserved-prefix") {
        return "name cannot start with `inst-` (reserved for IDs)";
      }
      return "name cannot be empty";
    },
  });
  if (isCancel(name)) return cancelAndExit();

  // --- Step 2: template ----------------------------------------------
  const templateSvc = deps.createTemplateService(host);
  const tmplResult = await templateSvc.list();
  if (!tmplResult.ok) {
    if (tmplResult.error.kind === "auth-required") {
      cancel(`not authenticated: ${tmplResult.error.reason}`);
      process.stderr.write("hint: run `dam auth login` first\n");
    } else {
      cancel(formatTransportError(tmplResult.error.reason, host));
    }
    process.exit(EXIT_INSTANCE_RUNTIME_FAILURE);
  }
  if (tmplResult.value.length === 0) {
    cancel("no templates available on this server");
    process.exit(EXIT_INSTANCE_RUNTIME_FAILURE);
  }

  const templateId = await select<string>({
    message: "Template",
    options: tmplResult.value.map((t) => ({
      value: t.id,
      label: t.name,
      ...(t.description ? { hint: t.description } : {}),
    })),
  });
  if (isCancel(templateId)) return cancelAndExit();

  // --- Steps 3 + 4: agents.create then instances.create --------------
  const trpc = deps.createTrpcClient(host);
  const spin = spinner();
  spin.start("Creating agent...");

  let agentId: string;
  try {
    const agent = await trpc.agents.create.mutate({ name, templateId });
    agentId = agent.id;
  } catch (e) {
    spin.stop("Failed to create agent");
    process.stderr.write(`error: ${errorReason(e)}\n`);
    process.exit(EXIT_INSTANCE_RUNTIME_FAILURE);
  }

  spin.message("Creating instance...");
  let instance: Instance;
  try {
    instance = await trpc.instances.create.mutate({ name, agentId });
  } catch (e) {
    spin.stop("Failed to create instance");
    process.stderr.write(`error: ${errorReason(e)}\n`);
    process.exit(EXIT_INSTANCE_RUNTIME_FAILURE);
  }

  // --- Step 5: wait for running --------------------------------------
  spin.message(`Waiting for instance to start (state: ${instance.state})...`);
  const svc = deps.createInstanceService(host);
  const waitResult = await waitForRunning(svc, instance.id, {
    timeoutSeconds: WAIT_TIMEOUT_SECONDS,
    graceSeconds: 0,
    onStateChange: (state) => {
      spin.message(`Waiting for instance to start (state: ${state})...`);
    },
  });

  switch (waitResult.kind) {
    case "ready":
      spin.stop("Instance running");
      outro(`✓ Agent created: ${name}\n→ Next: dam shell ${name}`);
      process.exit(EXIT_INSTANCE_SUCCESS);
      return;
    case "error":
      spin.stop(`Instance entered error state: ${waitResult.instance.error ?? "unknown"}`);
      note(`dam instance get ${name}`, "Inspect");
      process.exit(EXIT_INSTANCE_RUNTIME_FAILURE);
      return;
    case "timeout":
      // The agent + instance both exist server-side; the pod is just slow.
      // Per spec: warn and exit 0. The user can check progress with
      // `dam instance get`.
      spin.stop(`Instance still starting after ${WAIT_TIMEOUT_SECONDS}s (state: ${waitResult.lastState})`);
      note(`dam instance get ${name}`, "Check status");
      process.exit(EXIT_INSTANCE_SUCCESS);
      return;
    case "transport":
      spin.stop(`Lost connection while waiting: ${waitResult.reason}`);
      note(`dam instance get ${name}`, "Check status");
      process.exit(EXIT_INSTANCE_RUNTIME_FAILURE);
      return;
  }
}

function cancelAndExit(): void {
  cancel("Cancelled");
  process.exit(0);
}

function errorReason(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return "unknown failure";
}
