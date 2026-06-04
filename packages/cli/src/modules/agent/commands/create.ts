import { Command } from "commander";
import { agentCreateInputSchema } from "api-server-api";
import type { CompatService, ConfigService } from "../../cli/index.js";
import type { AgentView } from "../domain/agent-view.js";
import type { TemplateService } from "../../template/index.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";
import { classifyTrpcError } from "../../shared/trpc/classify.js";
import { parseOrExit } from "../../shared/parse-or-exit.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { parseTimeout } from "../../shared/parse-timeout.js";
import type { AgentService } from "../services/agent-service.js";
import { fetchOrFallback } from "../services/fetch-or-fallback.js";
import { waitForRunning } from "../services/wait-for-state.js";
import { formatTransportError, printServiceError } from "./errors.js";
import { parseEnvFlag, validateAgentName } from "./create-helpers.js";
import {
  EXIT_BELOW_FLOOR,
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";

const DEFAULT_TIMEOUT_SECONDS = 120;

export function buildCreateCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
  createTemplateService: (host: string) => TemplateService;
  createTrpcClient: (host: string) => TrpcClient;
}): Command {
  return new Command("create")
    .description("Create a new Agent from a template on the active host")
    .argument("<name>", "Agent name (1+ chars, must not start with `agent-`)")
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
    .option("--json", "emit raw Agent JSON instead of the default summary")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  dam agent create my-agent --template claude-code",
        "  dam agent create my-agent --template claude-code --wait",
        '  dam agent create my-agent --template pi-agent --env OPENAI_API_KEY=sk-… --description "Coding helper"',
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
  const nameCheck = validateAgentName(name);
  if (!nameCheck.ok) {
    if (nameCheck.error === "reserved-prefix") {
      process.stderr.write(
        `error: agent name \`${name}\` cannot start with \`agent-\` (reserved for IDs)\n`,
      );
    } else {
      process.stderr.write("error: agent name cannot be empty\n");
    }
    process.exit(EXIT_INVALID_INPUT);
  }

  if (!opts.template) {
    process.stderr.write(
      "error: `--template` is required; run `dam template list` to see options\n",
    );
    process.exit(EXIT_INVALID_INPUT);
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
    process.exit(EXIT_INVALID_INPUT);
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
    process.exit(EXIT_INVALID_INPUT);
  }

  const host = await resolveActiveHost(deps, {
    flag: opts.server ? { server: opts.server } : undefined,
    exitCodes: {
      runtimeFailure: EXIT_RUNTIME_FAILURE,
      belowFloor: EXIT_BELOW_FLOOR,
    },
  });

  const tmplResult = await deps.createTemplateService(host).list();
  if (!tmplResult.ok) {
    printServiceError(tmplResult.error, host);
    process.exit(EXIT_RUNTIME_FAILURE);
  }
  const match = tmplResult.value.find((t) => t.id === template);
  if (!match) {
    process.stderr.write(
      `error: unknown template \`${template}\`; available: ${tmplResult.value.map((t) => t.id).join(", ") || "(none)"}\n`,
    );
    process.exit(EXIT_INVALID_INPUT);
  }

  const trpc = deps.createTrpcClient(host);
  const createInput = await parseOrExit(
    agentCreateInputSchema,
    {
      name,
      templateId: template,
      description: opts.description,
      env: env.length > 0 ? env : undefined,
    },
    EXIT_INVALID_INPUT,
  );
  let agent: AgentView;
  try {
    agent = await trpc.agents.create.mutate(createInput);
  } catch (e) {
    if ((e as any)?.data?.code === "NOT_FOUND") {
      process.stderr.write(
        `error: template \`${template}\` was deleted while creating; retry\n`,
      );
      process.exit(EXIT_RUNTIME_FAILURE);
    }
    const classified = classifyTrpcError(e);
    if (!classified.ok && classified.error.kind === "auth-required") {
      process.stderr.write(
        `error: not authenticated: ${classified.error.reason}\nhint: run \`dam auth login\` first\n`,
      );
      process.exit(EXIT_RUNTIME_FAILURE);
    }
    process.stderr.write(`error: failed to create agent: ${errorReason(e)}\n`);
    process.exit(EXIT_RUNTIME_FAILURE);
  }

  let finalAgent = agent;
  if (opts.wait) {
    const svc = deps.createAgentService(host);
    let firstStateSeen = false;
    const waitResult = await waitForRunning(svc, agent.id, {
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
        finalAgent = waitResult.agent;
        break;
      case "error":
        finalAgent = waitResult.agent;
        if (opts.json) {
          process.stdout.write(`${JSON.stringify(finalAgent)}\n`);
        } else {
          const reason = waitResult.agent.error ?? "unknown";
          process.stderr.write(
            `error: agent "${name}" (${waitResult.agent.id}) entered error state: ${reason}\n`,
          );
        }
        process.exit(EXIT_RUNTIME_FAILURE);
        return;
      case "timeout":
        if (opts.json) {
          process.stdout.write(
            `${JSON.stringify(await fetchOrFallback(svc, agent, "after wait timeout"))}\n`,
          );
        } else {
          process.stderr.write(
            `error: timed out waiting for "${name}" to reach running (current: ${waitResult.lastState})\n`,
          );
        }
        process.exit(EXIT_RUNTIME_FAILURE);
        return;
      case "transport":
        process.stderr.write(
          `error: ${formatTransportError(waitResult.reason, host)}\n`,
        );
        process.exit(EXIT_RUNTIME_FAILURE);
        return;
    }
  }

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(finalAgent)}\n`);
  } else {
    process.stdout.write(
      `✓ Created agent "${finalAgent.name}" (${finalAgent.id}). State: ${finalAgent.state}.\n`,
    );
  }
  process.exit(EXIT_SUCCESS);
}

function errorReason(e: unknown): string {
  return e instanceof Error
    ? e.message
    : typeof e === "string"
      ? e
      : "unknown failure";
}
