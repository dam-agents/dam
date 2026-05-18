import { Command } from "commander";
import type { Instance } from "api-server-api";
import type { CompatService, ConfigService } from "../../cli/index.js";
import type { TemplateService } from "../../template/index.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";
import { classifyTrpcError } from "../../shared/trpc/classify.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { parseTimeout } from "../../shared/parse-timeout.js";
import type { InstanceService } from "../services/instance-service.js";
import { fetchOrFallback } from "../services/fetch-or-fallback.js";
import { waitForRunning } from "../services/wait-for-state.js";
import { formatTransportError, printServiceError } from "./errors.js";
import { parseEnvFlag, validateInstanceName } from "./create-helpers.js";
import {
  EXIT_INSTANCE_BELOW_FLOOR,
  EXIT_INSTANCE_INVALID_INPUT,
  EXIT_INSTANCE_RUNTIME_FAILURE,
  EXIT_INSTANCE_SUCCESS,
} from "./exit-codes.js";

const DEFAULT_TIMEOUT_SECONDS = 120;
const ROLLBACK_TIMEOUT_MS = 10_000;

// Definitive server rejections — safe to roll back the orphan agent.
const ROLLBACK_CODES = new Set([
  "CONFLICT",
  "BAD_REQUEST",
  "NOT_FOUND",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "PRECONDITION_FAILED",
  "UNIMPLEMENTED",
  "RESOURCE_EXHAUSTED",
]);

export function buildCreateCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createInstanceService: (host: string) => InstanceService;
  createTemplateService: (host: string) => TemplateService;
  createTrpcClient: (host: string) => TrpcClient;
}): Command {
  return new Command("create")
    .description("Create a new Instance from a template on the active host")
    .argument("<name>", "Instance name (1+ chars, must not start with `inst-`)")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option(
      "--template <id>",
      "template id (required; see `dam template list`)",
    )
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
        "  dam instance create my-agent --template claude-code",
        "  dam instance create my-agent --template claude-code --wait",
        '  dam instance create my-agent --template pi-agent --env OPENAI_API_KEY=sk-… --description "Coding helper"',
        "",
      ].join("\n"),
    )
    .action(
      async (
        name: string,
        opts: {
          server?: string;
          template?: string;
          description?: string;
          env?: string[];
          wait?: boolean;
          timeout?: string;
          json?: boolean;
        },
      ) => {
        await runCreate(name, opts, deps);
      },
    );
}

type CreateDeps = Parameters<typeof buildCreateCommand>[0];

async function runCreate(
  name: string,
  opts: {
    server?: string;
    template?: string;
    description?: string;
    env?: string[];
    wait?: boolean;
    timeout?: string;
    json?: boolean;
  },
  deps: CreateDeps,
): Promise<void> {
  const nameCheck = validateInstanceName(name);
  if (!nameCheck.ok) {
    if (nameCheck.error === "reserved-prefix") {
      process.stderr.write(
        `error: instance name \`${name}\` cannot start with \`inst-\` (reserved for IDs)\n`,
      );
    } else {
      process.stderr.write("error: instance name cannot be empty\n");
    }
    process.exit(EXIT_INSTANCE_INVALID_INPUT);
  }

  if (!opts.template) {
    process.stderr.write(
      "error: `--template` is required; run `dam template list` to see options\n",
    );
    process.exit(EXIT_INSTANCE_INVALID_INPUT);
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
    process.exit(EXIT_INSTANCE_INVALID_INPUT);
  }
  const env = envResult.value.vars;
  for (const dup of envResult.value.duplicates) {
    process.stderr.write(
      `warning: \`--env ${dup}=…\` was provided multiple times; using the last value\n`,
    );
  }

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

  const tmplResult = await deps.createTemplateService(host).list();
  if (!tmplResult.ok) {
    printServiceError(tmplResult.error, host);
    process.exit(EXIT_INSTANCE_RUNTIME_FAILURE);
  }
  const match = tmplResult.value.find((t) => t.id === template);
  if (!match) {
    process.stderr.write(
      `error: unknown template \`${template}\`; available: ${tmplResult.value.map((t) => t.id).join(", ") || "(none)"}\n`,
    );
    process.exit(EXIT_INSTANCE_INVALID_INPUT);
  }

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
    if ((e as any)?.data?.code === "NOT_FOUND") {
      process.stderr.write(
        `error: template \`${template}\` was deleted while creating; retry\n`,
      );
      process.exit(EXIT_INSTANCE_RUNTIME_FAILURE);
    }
    const classified = classifyTrpcError(e);
    if (!classified.ok && classified.error.kind === "auth-required") {
      process.stderr.write(
        `error: not authenticated: ${classified.error.reason}\nhint: run \`dam auth login\` first\n`,
      );
      process.exit(EXIT_INSTANCE_RUNTIME_FAILURE);
    }
    process.stderr.write(`error: failed to create agent: ${errorReason(e)}\n`);
    process.exit(EXIT_INSTANCE_RUNTIME_FAILURE);
  }

  let instance: Instance;
  try {
    instance = await trpc.instances.create.mutate({ name, agentId });
  } catch (e) {
    await tryRollbackAgent(trpc, agentId, e);
    process.exit(EXIT_INSTANCE_RUNTIME_FAILURE);
  }

  let finalInstance = instance;
  if (opts.wait) {
    const svc = deps.createInstanceService(host);
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
        process.exit(EXIT_INSTANCE_RUNTIME_FAILURE);
        return;
      case "timeout":
        if (opts.json) {
          process.stdout.write(
            `${JSON.stringify(await fetchOrFallback(svc, instance, "after wait timeout"))}\n`,
          );
        } else {
          process.stderr.write(
            `error: timed out waiting for "${name}" to reach running (current: ${waitResult.lastState})\n`,
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
    process.stdout.write(`${JSON.stringify(finalInstance)}\n`);
  } else {
    process.stdout.write(
      `✓ Created instance "${finalInstance.name}" (${finalInstance.id}). State: ${finalInstance.state}.\n`,
    );
  }
  process.exit(EXIT_INSTANCE_SUCCESS);
}

async function tryRollbackAgent(
  trpc: TrpcClient,
  agentId: string,
  originalError: unknown,
): Promise<void> {
  const code = (originalError as any)?.data?.code as string | undefined;
  if (!code || !ROLLBACK_CODES.has(code)) {
    process.stderr.write(
      `error: failed to create instance: ${errorReason(originalError)}\nhint: agent \`${agentId}\` may be orphaned; check via the web UI\n`,
    );
    return;
  }
  try {
    await Promise.race([
      trpc.agents.delete.mutate({ id: agentId }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("rollback timeout")),
          ROLLBACK_TIMEOUT_MS,
        ),
      ),
    ]);
    const msg = trpcMessage(originalError) ?? errorReason(originalError);
    process.stderr.write(`error: ${msg}\n`);
  } catch (rollbackErr) {
    process.stderr.write(
      `error: ${errorReason(originalError)}\nerror: also failed to clean up agent \`${agentId}\`: ${errorReason(rollbackErr)}\nhint: delete the orphan agent via the web UI\n`,
    );
  }
}

function errorReason(e: unknown): string {
  return e instanceof Error ? e.message : typeof e === "string" ? e : "unknown failure";
}

function trpcMessage(e: unknown): string | undefined {
  if (typeof e !== "object" || e === null) return undefined;
  const msg = (e as { message?: unknown }).message;
  return typeof msg === "string" && msg.length > 0 ? msg : undefined;
}
