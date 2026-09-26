import { Command } from "commander";
import { agentCreateInputSchema, PROVIDER_TEMPLATE_IDS } from "api-server-api";
import { CONNECTION_ID_PREFIX } from "../../connection/index.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import type { AgentView } from "../domain/agent-view.js";
import type { TemplateService } from "../../template/index.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";
import {
  classifyTrpcError,
  trpcCall,
  trpcErrorCode,
} from "../../shared/trpc/classify.js";
import { parseOrExit } from "../../shared/parse-or-exit.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { parseTimeout } from "../../shared/parse-timeout.js";
import type { AgentService } from "../services/agent-service.js";
import {
  printServiceError,
  exitOnServiceError,
} from "../../shared/trpc/print.js";
import {
  errorReason,
  parseEnvFlag,
  validateAgentName,
} from "./create-helpers.js";
import { waitForRunningOrExit } from "./wait-or-exit.js";
import {
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
    .argument(
      "<name>",
      "Agent name (1+ chars; not `agent-` plus 16 hex characters, the shape of an ID)",
    )
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
      "--provider <id-or-name>",
      "model-provider connection id or unique name (required; see `dam connection list`)",
    )
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
        "  dam agent create my-agent --template claude-code --provider conn-123",
        '  dam agent create my-agent --template claude-code --provider "My provider" --wait',
        '  dam agent create my-agent --template pi-agent --provider conn-123 --description "Coding helper"',
        "",
      ].join("\n"),
    )
    .action(
      async (
        name: string,
        opts: {
          server?: string;
          template?: string;
          provider?: string;
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
    provider?: string;
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
    if (nameCheck.error === "id-shape") {
      process.stderr.write(
        `error: agent name \`${name}\` has the shape of an agent ID (\`agent-\` and 16 hex characters)\n`,
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

  if (!opts.provider) {
    process.stderr.write(
      "error: `--provider <id-or-name>` is required; run `dam connection list` to choose a model provider, or `dam agent create-interactive` to add one\n",
    );
    process.exit(EXIT_INVALID_INPUT);
  }

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

  const host = await resolveActiveHost(deps, opts.server);

  const tmplResult = await deps.createTemplateService(host).list();
  exitOnServiceError(tmplResult, host);
  const selectedTemplate = tmplResult.value.find((t) => t.id === template);
  if (!selectedTemplate) {
    process.stderr.write(
      `error: unknown template \`${template}\`; available: ${tmplResult.value.map((t) => t.id).join(", ") || "(none)"}\n`,
    );
    process.exit(EXIT_INVALID_INPUT);
  }

  const trpc = deps.createTrpcClient(host);
  let providerConnectionId = opts.provider;
  if (!providerConnectionId.startsWith(CONNECTION_ID_PREFIX)) {
    const connections = await trpcCall(() => trpc.connections.list.query());
    if (!connections.ok) {
      printServiceError(connections.error, host);
      process.stderr.write(
        "hint: provider name lookup requires credentials:read; pass --provider <connection-id> to create with agents:manage alone\n",
      );
      process.exit(EXIT_RUNTIME_FAILURE);
    }
    const matches = connections.value.filter(
      (connection) =>
        PROVIDER_TEMPLATE_IDS.has(connection.templateId) &&
        connection.name === opts.provider,
    );
    if (matches.length !== 1) {
      process.stderr.write(
        matches.length === 0
          ? `error: no model-provider connection matches '${opts.provider}'; run \`dam connection list\` to choose a provider, or \`dam agent create-interactive\` to add one\n`
          : `error: multiple model-provider connections are named '${opts.provider}'; pass a connection id from \`dam connection list\`\n`,
      );
      process.exit(EXIT_INVALID_INPUT);
    }
    providerConnectionId = matches[0]!.id;
  }
  const createInput = await parseOrExit(agentCreateInputSchema, {
    name,
    templateId: template,
    connectionIds: [providerConnectionId],
    providerConnectionId,
    description: opts.description,
    env: env.length > 0 ? env : undefined,
  });
  let agent: AgentView;
  try {
    agent = await trpc.agents.create.mutate(createInput);
  } catch (e) {
    if (trpcErrorCode(e) === "BAD_REQUEST") {
      process.stderr.write(
        `error: failed to create agent: ${errorReason(e)}\n`,
      );
      process.exit(EXIT_INVALID_INPUT);
    }
    if (trpcErrorCode(e) === "NOT_FOUND") {
      process.stderr.write(
        `error: template \`${template}\` was deleted while creating; retry\n`,
      );
      process.exit(EXIT_RUNTIME_FAILURE);
    }
    const classified = classifyTrpcError(e);
    if (!classified.ok && classified.error.kind === "auth-required") {
      printServiceError(classified.error, host);
      process.exit(EXIT_RUNTIME_FAILURE);
    }
    process.stderr.write(`error: failed to create agent: ${errorReason(e)}\n`);
    process.exit(EXIT_RUNTIME_FAILURE);
  }

  const finalAgent = opts.wait
    ? await waitForRunningOrExit(deps.createAgentService(host), agent, {
        host,
        name,
        timeoutSeconds,
        graceSeconds: 0,
        json: opts.json,
        showIdOnError: true,
        refreshContext: "after wait timeout",
      })
    : agent;

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(finalAgent)}\n`);
  } else {
    process.stdout.write(
      `✓ Created agent "${finalAgent.name}" (${finalAgent.id}). State: ${finalAgent.state}.\n`,
    );
  }
  process.exit(EXIT_SUCCESS);
}
