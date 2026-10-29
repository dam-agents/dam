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
import { runCreateFromKit } from "./create-from-kit.js";
import { KIT_REF_HELP, type KitService } from "../../kit/index.js";
import type { AvatarUploader } from "../infrastructure/avatar-upload-client.js";
import {
  addAvatarOptions,
  avatarFromFlagsOrExit,
  type AvatarOpts,
} from "./avatar-flags.js";
import {
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";

const DEFAULT_TIMEOUT_SECONDS = 120;

interface CreateOpts extends AvatarOpts {
  server?: string;
  kit?: string;
  connection: string[];
  slackChannel: string[];
  skipSchedule: string[];
  template?: string;
  provider?: string;
  description?: string;
  env?: string[];
  wait?: boolean;
  timeout?: string;
  json?: boolean;
}

export function buildCreateCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
  createTemplateService: (host: string) => TemplateService;
  createTrpcClient: (host: string) => TrpcClient;
  createAvatarUploader: (host: string) => AvatarUploader;
  createKitService: (host: string) => KitService;
}): Command {
  const collect = (val: string, prev: string[]) => [...prev, val];
  const cmd = new Command("create")
    .description(
      "Create a new Agent on the active host, from a template or from a starter kit",
    )
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
      "template id (default: the install's default template; see `dam template list`)",
    )
    .option(
      "--kit <kit>",
      `create the agent from a starter kit, as the web app does (see \`dam kit list\`); ${KIT_REF_HELP}`,
    )
    .option(
      "--connection <id-or-name>",
      "with --kit: a connection to grant for what the kit needs, repeatable (see `dam kit show <kit>`)",
      collect,
      [] as string[],
    )
    .option(
      "--slack-channel <channel-id>",
      "with --kit: a Slack channel to bind, one you and the bot are both in, repeatable",
      collect,
      [] as string[],
    )
    .option(
      "--skip-schedule <name>",
      "with --kit: leave out one of the kit's schedules, repeatable",
      collect,
      [] as string[],
    )
    .option("--description <text>", "free-form description");
  return addAvatarOptions(cmd, "start with")
    .option(
      "--provider <id-or-name>",
      "model-provider connection id or unique name (default: your preferred provider; see `dam connection list`)",
    )
    .option(
      "--env <KEY=VAL>",
      "env var, repeatable",
      (val: string, prev: string[]) => [...prev, val],
      [] as string[],
    )
    .option(
      "--wait",
      "poll until state == `running`; stops early on error or a refused start (pool full)",
    )
    .option(
      "--timeout <seconds>",
      `--wait timeout in seconds (default ${DEFAULT_TIMEOUT_SECONDS})`,
    )
    .option(
      "--json",
      "emit raw Agent JSON instead of the default summary; with --kit, { agent, kit, skills, skillsError, steps }, each step { kind, required, what, note?, command, done }",
    )
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  dam agent create my-agent",
        '  dam agent create my-agent --provider "My provider" --wait',
        '  dam agent create my-agent --template default --provider conn-123 --description "Coding helper"',
        "  dam agent create my-agent --avatar spark",
        "  dam agent create researcher --kit spotlights --connection github --json",
        "",
      ].join("\n"),
    )
    .action(async (name: string, opts: CreateOpts) => {
      await runCreate(name, opts, deps);
    });
}

type CreateDeps = Parameters<typeof buildCreateCommand>[0];

async function runCreate(
  name: string,
  opts: CreateOpts,
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

  const template = opts.template;
  const kitOnly = [
    opts.connection.length > 0 && "--connection",
    opts.slackChannel.length > 0 && "--slack-channel",
    opts.skipSchedule.length > 0 && "--skip-schedule",
  ].filter((f): f is string => f !== false);
  if (opts.kit === undefined && kitOnly.length > 0) {
    process.stderr.write(`error: ${kitOnly.join(", ")} only go with --kit\n`);
    process.exit(EXIT_INVALID_INPUT);
  }
  if (opts.kit !== undefined) {
    const notWithKit = [
      opts.provider !== undefined && "--provider",
      opts.description !== undefined && "--description",
      (opts.env ?? []).length > 0 && "--env",
    ].filter((f): f is string => f !== false);
    if (notWithKit.length > 0) {
      process.stderr.write(
        `error: ${notWithKit.join(", ")} cannot go with --kit: the kit decides those; change them with \`dam agent update\` once it is created\n`,
      );
      process.exit(EXIT_INVALID_INPUT);
    }
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

  if (opts.kit !== undefined)
    return runCreateFromKit(
      name,
      { ...opts, kit: opts.kit },
      { host, timeoutSeconds },
      deps,
    );

  const tmplResult = await deps.createTemplateService(host).list();
  exitOnServiceError(tmplResult, host);
  if (
    template !== undefined &&
    !tmplResult.value.some((t) => t.id === template)
  ) {
    process.stderr.write(
      `error: unknown template \`${template}\`; available: ${tmplResult.value.map((t) => t.id).join(", ") || "(none)"}\n`,
    );
    process.exit(EXIT_INVALID_INPUT);
  }

  const trpc = deps.createTrpcClient(host);
  let providerConnectionId = opts.provider;
  if (
    providerConnectionId !== undefined &&
    !providerConnectionId.startsWith(CONNECTION_ID_PREFIX)
  ) {
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
  const avatar = await avatarFromFlagsOrExit(opts, {
    agentService: deps.createAgentService(host),
    uploader: deps.createAvatarUploader(host),
    host,
  });
  const createInput = await parseOrExit(agentCreateInputSchema, {
    name,
    ...(template !== undefined && { templateId: template }),
    ...(providerConnectionId !== undefined && {
      connectionIds: [providerConnectionId],
      providerConnectionId,
    }),
    description: opts.description,
    ...(avatar != null && { avatar }),
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
        `error: template \`${template ?? "default"}\` was deleted while creating; retry\n`,
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
