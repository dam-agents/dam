import { Command } from "commander";
import type { Instance } from "api-server-api";
import type { CompatService, ConfigService } from "../../cli/index.js";
import type { TemplatesService } from "../../templates/index.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";
import type { InstancesService } from "../services/instances-service.js";
import { waitForRunning } from "../services/wait-for-state.js";
import {
  describeConfigError,
  formatTransportError,
  printCompatResolveError,
} from "./errors.js";
import { parseEnvFlag, validateInstanceName } from "./create-helpers.js";
import {
  EXIT_INSTANCES_BELOW_FLOOR,
  EXIT_INSTANCES_INVALID_INPUT,
  EXIT_INSTANCES_RUNTIME_FAILURE,
  EXIT_INSTANCES_SUCCESS,
} from "./exit-codes.js";

const DEFAULT_TIMEOUT_SECONDS = 120;
const ROLLBACK_TIMEOUT_MS = 10_000;

const ROLLBACK_CODES = new Set([
  "CONFLICT",
  "BAD_REQUEST",
  "NOT_FOUND",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "PRECONDITION_FAILED",
]);

export interface CreateCommandDeps {
  compatService: CompatService;
  configService: ConfigService;
  createInstancesService: (host: string) => InstancesService;
  createTemplatesService: (host: string) => TemplatesService;
  /** Raw trpc client factory — the create command issues
   *  `agents.create` + `instances.create` directly because the rollback
   *  policy is too command-shaped to live in the service layer. */
  createTrpcClient: (host: string) => TrpcClient;
  serverEnvVar: string;
}

interface CliOpts {
  server?: string;
  template?: string;
  description?: string;
  env?: string[];
  wait?: boolean;
  timeout?: string;
  json?: boolean;
}

export function buildCreateCommand(deps: CreateCommandDeps): Command {
  return new Command("create")
    .description("Create a new Instance from a template on the active host")
    .argument("<name>", "Instance name (1+ chars, must not start with `inst-`)")
    .option("--server <url>", "override the configured server URL for this call")
    .option("--template <id>", "template id (required; see `dam templates list`)")
    .option("--description <text>", "free-form description")
    .option(
      "--env <KEY=VAL>",
      "env var, repeatable",
      (val: string, prev: string[]) => [...prev, val],
      [] as string[],
    )
    .option("--wait", "poll until state == `running` (or terminal error)")
    .option(
      "--timeout <seconds>",
      `--wait timeout in seconds (default ${DEFAULT_TIMEOUT_SECONDS})`,
    )
    .option("--json", "emit raw Instance JSON instead of the default summary")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  dam instances create my-agent --template claude-code",
        "  dam instances create my-agent --template claude-code --wait",
        "  dam instances create my-agent --template pi-agent --env OPENAI_API_KEY=sk-… --description \"Coding helper\"",
        "",
      ].join("\n"),
    )
    .action(async (name: string, opts: CliOpts) => {
      await runCreate(name, opts, deps);
    });
}

async function runCreate(name: string, opts: CliOpts, deps: CreateCommandDeps): Promise<void> {
  const flag = opts.server ? { server: opts.server } : undefined;

  // --- Local validation (no RPC) --------------------------------------
  const nameCheck = validateInstanceName(name);
  if (!nameCheck.ok) {
    if (nameCheck.error === "reserved-prefix") {
      process.stderr.write(
        `error: instance name \`${name}\` cannot start with \`inst-\` (reserved for IDs)\n`,
      );
    } else {
      process.stderr.write("error: instance name cannot be empty\n");
    }
    process.exit(EXIT_INSTANCES_INVALID_INPUT);
  }

  if (!opts.template) {
    process.stderr.write(
      "error: `--template` is required; run `dam templates list` to see options\n",
    );
    process.exit(EXIT_INSTANCES_INVALID_INPUT);
  }
  const template = opts.template;

  const envResult = parseEnvFlag(opts.env ?? []);
  if (!envResult.ok) {
    if (envResult.error.kind === "missing-equals") {
      process.stderr.write(
        `error: invalid \`--env\` value \`${envResult.error.input}\`; expected KEY=VAL\n`,
      );
    } else {
      process.stderr.write(
        `error: invalid env var name \`${envResult.error.key}\`; must match [A-Z_][A-Z0-9_]*\n`,
      );
    }
    process.exit(EXIT_INSTANCES_INVALID_INPUT);
  }
  const env = envResult.value;

  const timeoutSeconds = parseTimeout(opts.timeout);
  if (timeoutSeconds === null) {
    process.stderr.write(
      `error: invalid \`--timeout\` value \`${opts.timeout}\`; expected positive integer\n`,
    );
    process.exit(EXIT_INSTANCES_INVALID_INPUT);
  }

  // --- Compat pre-flight ----------------------------------------------
  const compat = await deps.compatService.check({ flag });
  if (!compat.ok) {
    printCompatResolveError(compat.error, deps.serverEnvVar);
    process.exit(EXIT_INSTANCES_RUNTIME_FAILURE);
  }
  const verdict = compat.value;
  if (verdict.kind === "below-floor") {
    process.stderr.write(
      `error: CLI ${verdict.localCli} is below the server's minimum required version ${verdict.serverMinClient}; upgrade and retry\n`,
    );
    process.exit(EXIT_INSTANCES_BELOW_FLOOR);
  }
  if (verdict.kind === "behind-current") {
    process.stderr.write(
      `warning: CLI ${verdict.localCli} is behind server ${verdict.serverVersion}; consider upgrading\n`,
    );
  }

  const cfg = await deps.configService.getResolved({ flag });
  if (!cfg.ok) {
    process.stderr.write(`error: ${describeConfigError(cfg.error)}\n`);
    process.exit(EXIT_INSTANCES_RUNTIME_FAILURE);
  }
  const host = cfg.value.server;

  // --- Step 1: template pre-validation --------------------------------
  const templatesSvc = deps.createTemplatesService(host);
  const tmplResult = await templatesSvc.list();
  if (!tmplResult.ok) {
    if (tmplResult.error.kind === "auth-required") {
      process.stderr.write(`error: not authenticated: ${tmplResult.error.reason}\n`);
      process.stderr.write("hint: run `dam auth login` first\n");
    } else {
      process.stderr.write(`error: ${formatTransportError(tmplResult.error.reason, host)}\n`);
    }
    process.exit(EXIT_INSTANCES_RUNTIME_FAILURE);
  }
  const match = tmplResult.value.find((t) => t.id === template);
  if (!match) {
    const available = tmplResult.value.map((t) => t.id).join(", ");
    process.stderr.write(
      `error: unknown template \`${template}\`; available: ${available || "(none)"}\n`,
    );
    process.exit(EXIT_INSTANCES_INVALID_INPUT);
  }

  // --- Steps 2 + 3: agents.create then instances.create ---------------
  const trpc = deps.createTrpcClient(host);
  let agentId: string;
  try {
    const agent = await trpc.agents.create.mutate({
      name,
      templateId: template,
      description: opts.description,
      env: env.length > 0 ? env : undefined,
    });
    agentId = agent.id;
  } catch (e) {
    if (hasTrpcCode(e, "NOT_FOUND")) {
      process.stderr.write(
        `error: template \`${template}\` was deleted while creating; retry\n`,
      );
      process.exit(EXIT_INSTANCES_RUNTIME_FAILURE);
    }
    if (isAuthSentinelError(e)) {
      process.stderr.write(`error: not authenticated: ${errorReason(e)}\n`);
      process.stderr.write("hint: run `dam auth login` first\n");
      process.exit(EXIT_INSTANCES_RUNTIME_FAILURE);
    }
    process.stderr.write(`error: failed to create agent: ${errorReason(e)}\n`);
    process.exit(EXIT_INSTANCES_RUNTIME_FAILURE);
  }

  let instance: Instance;
  try {
    instance = await trpc.instances.create.mutate({ name, agentId });
  } catch (e) {
    await tryRollbackAgent(trpc, agentId, e);
    process.exit(EXIT_INSTANCES_RUNTIME_FAILURE);
  }

  // --- Step 4: optional --wait ----------------------------------------
  let finalInstance = instance;
  if (opts.wait) {
    const svc = deps.createInstancesService(host);
    let firstStateSeen = false;
    const waitResult = await waitForRunning(svc, instance.id, {
      timeoutSeconds,
      graceSeconds: 0,
      onStateChange: (state) => {
        if (opts.json) return;
        if (!firstStateSeen) {
          process.stderr.write(`Waiting for "${name}"… state: ${state}\n`);
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
        finalInstance = waitResult.instance;
        if (opts.json) {
          process.stdout.write(`${JSON.stringify(finalInstance)}\n`);
        } else {
          const reason = waitResult.instance.error ?? "unknown";
          process.stderr.write(
            `error: instance "${name}" (${waitResult.instance.id}) entered error state: ${reason}\n`,
          );
        }
        process.exit(EXIT_INSTANCES_RUNTIME_FAILURE);
        return;
      case "timeout":
        if (opts.json) {
          const refreshed = await svc.get(instance.id);
          if (refreshed.ok && refreshed.value !== null) {
            process.stdout.write(`${JSON.stringify(refreshed.value)}\n`);
          }
        } else {
          process.stderr.write(
            `error: timed out waiting for "${name}" to reach running (current: ${waitResult.lastState})\n`,
          );
        }
        process.exit(EXIT_INSTANCES_RUNTIME_FAILURE);
        return;
      case "transport":
        process.stderr.write(`error: ${formatTransportError(waitResult.reason, host)}\n`);
        process.exit(EXIT_INSTANCES_RUNTIME_FAILURE);
        return;
    }
  }

  // --- Output ---------------------------------------------------------
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(finalInstance)}\n`);
  } else {
    process.stdout.write(
      `✓ Created instance "${finalInstance.name}" (${finalInstance.id}). State: ${finalInstance.state}.\n`,
    );
  }
  process.exit(EXIT_INSTANCES_SUCCESS);
}

function parseTimeout(raw: string | undefined): number | null {
  if (raw === undefined) return DEFAULT_TIMEOUT_SECONDS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

async function tryRollbackAgent(
  trpc: TrpcClient,
  agentId: string,
  originalError: unknown,
): Promise<void> {
  const code = trpcCode(originalError);
  if (!code || !ROLLBACK_CODES.has(code)) {
    // Ambiguous outcome (INTERNAL_SERVER_ERROR, network) — the instance
    // may or may not have been created server-side. Don't roll back; the
    // user can inspect via the UI.
    process.stderr.write(`error: failed to create instance: ${errorReason(originalError)}\n`);
    process.stderr.write(`hint: agent \`${agentId}\` may be orphaned; check via the web UI\n`);
    return;
  }
  try {
    await Promise.race([
      trpc.agents.delete.mutate({ id: agentId }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("rollback timeout")), ROLLBACK_TIMEOUT_MS),
      ),
    ]);
    const msg = trpcMessage(originalError) ?? errorReason(originalError);
    process.stderr.write(`error: ${msg}\n`);
  } catch (rollbackErr) {
    process.stderr.write(`error: ${errorReason(originalError)}\n`);
    process.stderr.write(
      `error: also failed to clean up agent \`${agentId}\`: ${errorReason(rollbackErr)}\n`,
    );
    process.stderr.write("hint: delete the orphan agent via the web UI\n");
  }
}

function hasTrpcCode(e: unknown, code: string): boolean {
  return trpcCode(e) === code;
}

function trpcCode(e: unknown): string | undefined {
  if (typeof e !== "object" || e === null) return undefined;
  return (e as { data?: { code?: string } }).data?.code;
}

function trpcMessage(e: unknown): string | undefined {
  if (typeof e !== "object" || e === null) return undefined;
  const msg = (e as { message?: unknown }).message;
  return typeof msg === "string" && msg.length > 0 ? msg : undefined;
}

function errorReason(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return "unknown failure";
}

function isAuthSentinelError(e: unknown): boolean {
  let cursor: unknown = e;
  let depth = 0;
  while (cursor && depth < 8) {
    if (typeof cursor === "object" && cursor !== null) {
      const name = (cursor as { name?: unknown }).name;
      if (name === "AuthRequiredAtTransportError") return true;
    }
    cursor = (cursor as { cause?: unknown }).cause;
    depth++;
  }
  return false;
}
