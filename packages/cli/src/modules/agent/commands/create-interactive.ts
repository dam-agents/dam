import {
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  note,
  outro,
  select,
  spinner,
  text,
} from "@clack/prompts";
import { Command } from "commander";
import {
  agentCreateInputSchema,
  type ConnectionTemplateView,
  type ConnectionView,
  PROVIDER_PRESET_TYPES,
  PROVIDER_TEMPLATE_IDS,
  PROVIDERS,
  type ProviderPresetType,
  providerTypeForTemplateId,
  templateIdForProvider,
} from "api-server-api";
import type { CompatService, ConfigService } from "../../cli/index.js";
import type { AgentService } from "../services/agent-service.js";
import type { AgentView } from "../domain/agent-view.js";
import { validateAgentName } from "./create-helpers.js";
import { formatTransportError } from "../../shared/trpc/print.js";
import { parseOrExit } from "../../shared/parse-or-exit.js";
import { promptSecret } from "../../shared/prompt-secret.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import {
  EXIT_BELOW_FLOOR,
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import { waitForRunning } from "../services/wait-for-state.js";
import type { TemplateService } from "../../template/index.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";
import {
  configInputsOf,
  validateConfigInputValue,
} from "../../connection/index.js";

const WAIT_TIMEOUT_SECONDS = 120;

const GITHUB_PAT_TEMPLATE_ID = "github-pat";

const CONNECTION_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const ROLLBACK_CODES: ReadonlySet<string> = new Set([
  "CONFLICT",
  "BAD_REQUEST",
  "NOT_FOUND",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "PRECONDITION_FAILED",
  "UNIMPLEMENTED",
  "RESOURCE_EXHAUSTED",
]);

interface Cleanup {
  newConnectionIds: string[];
  agentId: string | null;
}

function trpcCode(e: unknown): string | undefined {
  if (typeof e !== "object" || e === null) return undefined;
  return (e as { data?: { code?: string } }).data?.code;
}

function classifyFailure(e: unknown): "rollback" | "ambiguous" {
  const code = trpcCode(e);
  return code !== undefined && ROLLBACK_CODES.has(code)
    ? "rollback"
    : "ambiguous";
}

async function deleteCreated(
  trpc: TrpcClient,
  cleanup: Cleanup,
): Promise<{ orphanAgent: string | null; orphanConnections: string[] }> {
  let orphanAgent: string | null = null;
  const orphanConnections: string[] = [];
  if (cleanup.agentId) {
    try {
      await trpc.agents.delete.mutate({ id: cleanup.agentId });
    } catch {
      orphanAgent = cleanup.agentId;
    }
  }
  for (const id of cleanup.newConnectionIds) {
    try {
      await trpc.connections.delete.mutate({ id });
    } catch {
      orphanConnections.push(id);
    }
  }
  return { orphanAgent, orphanConnections };
}

function formatOrphans(
  orphanAgent: string | null,
  orphanConnections: readonly string[],
): string | null {
  if (!orphanAgent && orphanConnections.length === 0) return null;
  const lines = ["Cleanup partially failed. Manual cleanup needed:"];
  if (orphanAgent) {
    lines.push(
      `  Agent: ${orphanAgent} (delete via web UI or \`dam agent delete\`)`,
    );
  }
  if (orphanConnections.length > 0) {
    lines.push(
      `  Connections: ${orphanConnections.join(", ")} (delete via \`dam connection disconnect\`)`,
    );
  }
  return lines.join("\n");
}

export interface CreateAgentInteractiveCommandDeps {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
  createTemplateService: (host: string) => TemplateService;
  createTrpcClient: (host: string) => TrpcClient;
  serverEnvVar: string;
}

interface CliOpts {
  server?: string;
}

export function buildCreateInteractiveCommand(
  deps: CreateAgentInteractiveCommandDeps,
): Command {
  return new Command("create-interactive")
    .description("Interactively create an agent with credentials and channels")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .action(async (opts: CliOpts) => {
      await runCreate(opts, deps);
    });
}

async function runCreate(
  opts: CliOpts,
  deps: CreateAgentInteractiveCommandDeps,
): Promise<void> {
  if (!process.stdin.isTTY) {
    process.stderr.write(
      "error: dam agent create-interactive requires an interactive terminal; use `dam agent create` for scripted setup\n",
    );
    process.exit(EXIT_RUNTIME_FAILURE);
  }

  intro("dam agent create-interactive");

  const flag = opts.server ? { server: opts.server } : undefined;

  const host = await resolveActiveHost(deps, {
    flag,
    exitCodes: {
      runtimeFailure: EXIT_RUNTIME_FAILURE,
      belowFloor: EXIT_BELOW_FLOOR,
    },
  });

  const name = await text({
    message: "Agent name",
    placeholder: "my-agent",
    validate(value) {
      const check = validateAgentName(value ?? "");
      if (check.ok) return undefined;
      if (check.error === "reserved-prefix") {
        return "name cannot start with `agent-` (reserved for IDs)";
      }
      return "name cannot be empty";
    },
  });
  if (isCancel(name)) return cancelAndExit();

  const templateSvc = deps.createTemplateService(host);
  const tmplResult = await templateSvc.list();
  if (!tmplResult.ok) {
    if (tmplResult.error.kind === "auth-required") {
      cancel(
        `not authenticated: ${tmplResult.error.reason}\nhint: run \`dam auth login\` first`,
      );
    } else {
      cancel(formatTransportError(tmplResult.error.reason, host));
    }
    process.exit(EXIT_RUNTIME_FAILURE);
  }
  if (tmplResult.value.length === 0) {
    cancel("no templates available on this server");
    process.exit(EXIT_RUNTIME_FAILURE);
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

  const trpc = deps.createTrpcClient(host);
  const cleanup: Cleanup = { newConnectionIds: [], agentId: null };

  const provider = await pickProvider(trpc, cleanup);

  const githubPat = await pickGithubPat(trpc, cleanup);

  const spin = spinner();
  spin.start("Creating agent...");

  const createInput = await parseOrExit(
    agentCreateInputSchema,
    { name, templateId },
    EXIT_INVALID_INPUT,
    async () => {
      spin.stop("Invalid input");
      await flushCleanup(trpc, cleanup);
    },
  );
  let agent: AgentView;
  try {
    agent = await trpc.agents.create.mutate(createInput);
    cleanup.agentId = agent.id;
  } catch (e) {
    spin.stop("Setup failed");
    await handleStage1Failure(trpc, cleanup, e);
    process.exit(EXIT_RUNTIME_FAILURE);
  }

  spin.message("Granting credentials...");
  const connectionIds: string[] = [provider.routing.id];
  if (githubPat) connectionIds.push(githubPat.connectionId);
  try {
    await withRetry(async () => {
      await trpc.connections.setAgentConnections.mutate({
        agentId: cleanup.agentId!,
        connectionIds,
      });
    });
  } catch (e) {
    spin.stop("Grant failed");
    log.error(`Failed to grant credentials: ${errorReason(e)}`);
    log.warn(
      `Agent ${name} was created but the credential grant did not land. ` +
        `Configure access via the web UI, or run \`dam agent delete ${name}\` to start over.`,
    );
    process.exit(EXIT_RUNTIME_FAILURE);
  }

  spin.message(`Waiting for agent to start (state: ${agent.state})...`);
  const svc = deps.createAgentService(host);

  const onSigint = () => {
    spin.stop("Cancelled");
    log.warn(
      `Agent ${name} already exists; delete with \`dam agent delete ${name}\` if not needed.`,
    );
    process.exit(EXIT_RUNTIME_FAILURE);
  };
  process.once("SIGINT", onSigint);

  let waitResult;
  try {
    waitResult = await waitForRunning(svc, agent.id, {
      timeoutSeconds: WAIT_TIMEOUT_SECONDS,
      graceSeconds: 0,
      onStateChange: (state) => {
        spin.message(`Waiting for agent to start (state: ${state})...`);
      },
    });
  } finally {
    process.removeListener("SIGINT", onSigint);
  }

  switch (waitResult.kind) {
    case "ready": {
      spin.stop("Agent running");
      const lines = [
        `✓ Agent created: ${name}`,
        `✓ Provider: ${provider.name} (${provider.type})`,
        ...(githubPat ? [`✓ GitHub: ${githubPat.name}`] : []),
        `→ Next: dam chat ${name}`,
      ];
      outro(lines.join("\n"));
      process.exit(EXIT_SUCCESS);
      return;
    }
    case "error":
      spin.stop(
        `Agent entered error state: ${waitResult.agent.error ?? "unknown"}`,
      );
      note(`dam agent get ${name}`, "Inspect");
      process.exit(EXIT_RUNTIME_FAILURE);
      return;
    case "timeout":
      spin.stop(
        `Agent still starting after ${WAIT_TIMEOUT_SECONDS}s (state: ${waitResult.lastState})`,
      );
      note(`dam agent get ${name}`, "Check status");
      process.exit(EXIT_SUCCESS);
      return;
    case "transport":
      spin.stop(`Lost connection while waiting: ${waitResult.reason}`);
      note(`dam agent get ${name}`, "Check status");
      process.exit(EXIT_RUNTIME_FAILURE);
      return;
  }
}

function cancelAndExit(): never {
  cancel("Cancelled");
  process.exit(0);
}

async function cancelAndCleanup(
  trpc: TrpcClient,
  cleanup: Cleanup,
): Promise<never> {
  cancel("Cancelled");
  await flushCleanup(trpc, cleanup);
  process.exit(0);
}

async function flushCleanup(trpc: TrpcClient, cleanup: Cleanup): Promise<void> {
  if (cleanup.agentId === null && cleanup.newConnectionIds.length === 0) return;
  const { orphanAgent, orphanConnections } = await deleteCreated(trpc, cleanup);
  const summary = formatOrphans(orphanAgent, orphanConnections);
  if (summary) log.warn(summary);
}

async function handleStage1Failure(
  trpc: TrpcClient,
  cleanup: Cleanup,
  originalError: unknown,
): Promise<void> {
  const reason = errorReason(originalError);
  if (classifyFailure(originalError) === "rollback") {
    await flushCleanup(trpc, cleanup);
    log.error(`Failed to create agent: ${reason}`);
    return;
  }

  log.error(`Failed to create agent: ${reason}`);
  const lines: string[] = [];
  if (cleanup.agentId) lines.push(`  Agent: ${cleanup.agentId}`);
  if (cleanup.newConnectionIds.length > 0) {
    lines.push(`  Connections: ${cleanup.newConnectionIds.join(", ")}`);
  }
  if (lines.length > 0) {
    log.warn(
      [
        "These may have been created server-side; check via the web UI:",
        ...lines,
      ].join("\n"),
    );
  }
}

interface ProviderSelection {
  routing: { id: string };
  name: string;
  type: string;
}

interface ExistingProviderConn {
  id: string;
  name: string;
  templateId: string;
  type: ProviderPresetType;
}

async function listCredentials(trpc: TrpcClient, cleanup: Cleanup) {
  try {
    return {
      conns: await trpc.connections.list.query(),
      templates: await trpc.connections.listTemplates.query(),
    };
  } catch (e) {
    cancel(`failed to list credentials: ${errorReason(e)}`);
    await flushCleanup(trpc, cleanup);
    process.exit(EXIT_RUNTIME_FAILURE);
  }
}

async function pickProvider(
  trpc: TrpcClient,
  cleanup: Cleanup,
): Promise<ProviderSelection> {
  const { conns, templates } = await listCredentials(trpc, cleanup);

  const existingConns = providerConns(conns);

  if (existingConns.length === 0) {
    log.info("No model providers configured yet — let's add one.");
    return addOrReplaceProvider(trpc, cleanup, existingConns, templates);
  }

  const NEW = "__new__";
  const picked = await select<string>({
    message: "Model provider",
    options: [
      ...existingConns.map((c) => ({
        value: `conn:${c.id}`,
        label: `${c.name} (${c.type})`,
      })),
      { value: NEW, label: "Add new..." },
    ],
  });
  if (isCancel(picked)) return cancelAndCleanup(trpc, cleanup);

  if (picked === NEW) {
    return addOrReplaceProvider(trpc, cleanup, existingConns, templates);
  }

  const found = existingConns.find((c) => `conn:${c.id}` === picked)!;
  return {
    routing: { id: found.id },
    name: found.name,
    type: found.type,
  };
}

function providerConns(
  conns: readonly ConnectionView[],
): ExistingProviderConn[] {
  return conns
    .filter((c) => PROVIDER_TEMPLATE_IDS.has(c.templateId))
    .map((c) => {
      const type = providerTypeForTemplateId(c.templateId);
      return type
        ? { id: c.id, name: c.name, templateId: c.templateId, type }
        : null;
    })
    .filter((c): c is ExistingProviderConn => c !== null);
}

async function addOrReplaceProvider(
  trpc: TrpcClient,
  cleanup: Cleanup,
  existingConns: readonly ExistingProviderConn[],
  templates: readonly ConnectionTemplateView[],
): Promise<ProviderSelection> {
  while (true) {
    const type = await select<ProviderPresetType>({
      message: "Provider type",
      options: PROVIDER_PRESET_TYPES.map((t) => ({
        value: t,
        label: PROVIDERS[t].displayName,
      })),
    });
    if (isCancel(type)) return cancelAndCleanup(trpc, cleanup);

    const existingOfType = existingConns.find((c) => c.type === type);

    if (existingOfType) {
      const replace = await confirm({
        message: `A ${PROVIDERS[type].displayName} connection already exists. Replace its credential?`,
        initialValue: false,
      });
      if (isCancel(replace)) return cancelAndCleanup(trpc, cleanup);

      if (!replace) {
        return {
          routing: { id: existingOfType.id },
          name: existingOfType.name,
          type,
        };
      }

      const value = await promptSecret(
        `New ${PROVIDERS[type].displayName} credential`,
      );
      if (isCancel(value)) return cancelAndCleanup(trpc, cleanup);

      const templateId = templateIdForProvider(type, value);
      if (templateId !== existingOfType.templateId) {
        const have =
          existingOfType.templateId === "anthropic-oauth"
            ? "an OAuth token"
            : "an API key";
        const got =
          templateId === "anthropic-oauth" ? "an OAuth token" : "an API key";
        log.error(
          `This connection expects ${have}, but that looks like ${got}. Paste a matching credential, or disconnect it and add a new one to switch.`,
        );
        continue;
      }
      try {
        await trpc.connections.update.mutate({
          id: existingOfType.id,
          value,
        });
        return {
          routing: { id: existingOfType.id },
          name: existingOfType.name,
          type,
        };
      } catch (e) {
        log.error(`Failed to replace credential: ${errorReason(e)}`);
        continue;
      }
    }

    const value = await promptSecret(
      `${PROVIDERS[type].displayName} credential`,
    );
    if (isCancel(value)) return cancelAndCleanup(trpc, cleanup);

    const templateId = templateIdForProvider(type, value);
    const template = templates.find((t) => t.id === templateId);
    const configInputs = template
      ? await promptConfigInputs(trpc, cleanup, template)
      : {};

    const created = await createProviderConnection(
      trpc,
      cleanup,
      type,
      templateId,
      value,
      configInputs,
    );
    if (created) return created;
  }
}

async function promptConfigInputs(
  trpc: TrpcClient,
  cleanup: Cleanup,
  template: ConnectionTemplateView,
): Promise<Record<string, string>> {
  const inputs = configInputsOf(template);
  if (inputs.length === 0) return {};

  note("Optional configuration — press Enter to skip each.");
  const out: Record<string, string> = {};
  for (const input of inputs) {
    const label = input.label ?? input.name;
    if (input.enumValues) {
      const SKIP = "__skip__";
      const choice = await select<string>({
        message: input.hint ? `${label} — ${input.hint}` : label,
        options: [
          ...input.enumValues.map((v) => ({ value: v, label: v })),
          { value: SKIP, label: "Skip" },
        ],
        initialValue: SKIP,
      });
      if (isCancel(choice)) return cancelAndCleanup(trpc, cleanup);
      if (choice !== SKIP) out[input.name] = choice;
      continue;
    }
    const answer = await text({
      message: input.hint ? `${label} — ${input.hint}` : label,
      validate: (v) => validateConfigInputValue(input, v ?? ""),
    });
    if (isCancel(answer)) return cancelAndCleanup(trpc, cleanup);
    const trimmed = answer.trim();
    if (trimmed) out[input.name] = trimmed;
  }
  return out;
}

async function createConnectionWithRename(
  trpc: TrpcClient,
  cleanup: Cleanup,
  params: {
    templateId: string;
    name: string;
    value: string;
    nameExample: string;
    configInputs?: Record<string, string>;
  },
): Promise<{ id: string; name: string } | null> {
  let name = params.name;
  const hasConfig =
    params.configInputs && Object.keys(params.configInputs).length > 0;
  while (true) {
    try {
      const created = await trpc.connections.create.mutate({
        templateId: params.templateId,
        name,
        authKind: "header",
        value: params.value,
        ...(hasConfig ? { configInputs: params.configInputs } : {}),
      });
      cleanup.newConnectionIds.push(created.id);
      return { id: created.id, name };
    } catch (e) {
      if (trpcCode(e) === "CONFLICT") {
        const renamed = await text({
          message: `A connection named "${name}" already exists. Choose a different name`,
          validate(v) {
            if (!v || !CONNECTION_NAME_RE.test(v)) {
              return `lowercase letters, digits, and single hyphens (e.g. ${params.nameExample})`;
            }
            return undefined;
          },
        });
        if (isCancel(renamed)) return cancelAndCleanup(trpc, cleanup);
        name = renamed;
        continue;
      }
      log.error(`Failed to create connection: ${errorReason(e)}`);
      return null;
    }
  }
}

async function createProviderConnection(
  trpc: TrpcClient,
  cleanup: Cleanup,
  type: ProviderPresetType,
  templateId: string,
  value: string,
  configInputs: Record<string, string>,
): Promise<ProviderSelection | null> {
  const created = await createConnectionWithRename(trpc, cleanup, {
    templateId,
    name: templateId,
    value,
    nameExample: "my-anthropic",
    configInputs,
  });
  if (!created) return null;
  return {
    routing: { id: created.id },
    name: created.name,
    type,
  };
}

interface GithubSelection {
  connectionId: string;
  name: string;
}

const DEFAULT_GITHUB_PAT_NAME = GITHUB_PAT_TEMPLATE_ID;

async function pickGithubPat(
  trpc: TrpcClient,
  cleanup: Cleanup,
): Promise<GithubSelection | null> {
  const { conns } = await listCredentials(trpc, cleanup);
  const patConns = conns.filter((c) => c.templateId === GITHUB_PAT_TEMPLATE_ID);

  if (patConns.length === 0) {
    log.info("No GitHub PAT configured yet.");
    const add = await confirm({ message: "Add one?", initialValue: true });
    if (isCancel(add)) return cancelAndCleanup(trpc, cleanup);
    if (!add) return null;
    return addOrReplaceGithubPat(trpc, cleanup, patConns);
  }

  const NEW = "__new__";
  const SKIP = "__skip__";
  const picked = await select<string>({
    message: "GitHub PAT",
    options: [
      ...patConns.map((c) => ({ value: `conn:${c.id}`, label: c.name })),
      { value: NEW, label: "Add new..." },
      { value: SKIP, label: "Skip" },
    ],
  });
  if (isCancel(picked)) return cancelAndCleanup(trpc, cleanup);
  if (picked === SKIP) return null;
  if (picked === NEW) return addOrReplaceGithubPat(trpc, cleanup, patConns);

  const found = patConns.find((c) => `conn:${c.id}` === picked)!;
  return { connectionId: found.id, name: found.name };
}

async function addOrReplaceGithubPat(
  trpc: TrpcClient,
  cleanup: Cleanup,
  existing: readonly ConnectionView[],
): Promise<GithubSelection> {
  const collide = existing.find((c) => c.name === DEFAULT_GITHUB_PAT_NAME);

  while (true) {
    if (collide) {
      const replace = await confirm({
        message: `A GitHub PAT connection named "${DEFAULT_GITHUB_PAT_NAME}" already exists. Replace its token?`,
        initialValue: false,
      });
      if (isCancel(replace)) return cancelAndCleanup(trpc, cleanup);

      if (!replace) {
        return { connectionId: collide.id, name: collide.name };
      }

      const token = await promptSecret("New GitHub personal access token");
      if (isCancel(token)) return cancelAndCleanup(trpc, cleanup);

      try {
        await trpc.connections.update.mutate({ id: collide.id, value: token });
        return { connectionId: collide.id, name: collide.name };
      } catch (e) {
        log.error(`Failed to replace GitHub PAT: ${errorReason(e)}`);
        continue;
      }
    }

    const token = await promptSecret("GitHub personal access token");
    if (isCancel(token)) return cancelAndCleanup(trpc, cleanup);

    const created = await createConnectionWithRename(trpc, cleanup, {
      templateId: GITHUB_PAT_TEMPLATE_ID,
      name: DEFAULT_GITHUB_PAT_NAME,
      value: token,
      nameExample: "my-github",
    });
    if (created) {
      return { connectionId: created.id, name: created.name };
    }
  }
}

async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 5,
  delayMs = 2000,
): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (classifyFailure(e) === "rollback") throw e;
      if (attempt === maxAttempts - 1) throw e;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error("withRetry: exhausted attempts");
}

function errorReason(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return "unknown failure";
}
