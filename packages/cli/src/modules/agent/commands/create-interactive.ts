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
  type ConnectionView,
  isProviderPresetType,
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
import { formatTransportError } from "./errors.js";
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
  groupGithubPats,
  type GithubPatPair,
} from "../lib/group-github-pats.js";

const WAIT_TIMEOUT_SECONDS = 120;

// Not a model provider, so it lives outside the shared registry.
const GITHUB_PAT_TEMPLATE_ID = "github-pat";

// Connection names must be lowercase-kebab (DB-enforced).
const CONNECTION_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// TRPCError codes where the server definitively rejected a mutation — the
// resource was never created, so rolling back what we created in this run
// is safe. Codes outside this set (INTERNAL_SERVER_ERROR, transport) are
// ambiguous: the mutation may have succeeded server-side, and a rollback
// delete would destroy real state. Mirrors `dam agent create`'s
// ROLLBACK_CODES.
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
  /** Connection IDs created during this run (provider and/or GitHub PAT). */
  newConnectionIds: string[];
  /** Set once `agents.create` has returned an id. Cascade-deletes the
   *  agent's grants via the K8s OwnerReference chain when passed to
   *  `agents.delete`. */
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

/**
 * Best-effort tear-down of everything in the ledger. Agent first (cascade
 * tears down any owned children via OwnerReferences), then any new
 * connections. Whatever fails to delete is returned as orphan info so the
 * caller can surface it. One pass — if the api-server is down, the orphan
 * list is the best we can do.
 */
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

/**
 * Deps for `dam agent create-interactive`. Mirrors `dam agent create`'s
 * shape so the orchestration verbs can drop in without widening the
 * interface.
 */
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

  // --- Step 1: name --------------------------------------------------
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

  // --- Step 2: template ----------------------------------------------
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

  // --- Rollback bookkeeping ------------------------------------------
  // Anything created during *this* run goes here so a cancel between
  // prompts (Critical #1) or a downstream mutation failure can clean it
  // up. Pickers push into this ledger immediately on successful create
  // so the entry is in place by the time control returns. Existing
  // connections/secrets the user picked or replaced stay out: a replace-
  // existing path overwrote the value in place and the old value isn't
  // recoverable, so rollback would be destructive.
  const trpc = deps.createTrpcClient(host);
  const cleanup: Cleanup = { newConnectionIds: [], agentId: null };

  // --- Step 3: model provider ---------------------------------------
  const provider = await pickProvider(trpc, cleanup);

  // --- Step 4: optional GitHub PAT ----------------------------------
  const githubPat = await pickGithubPat(trpc, cleanup);

  // --- Step 5: agents.create ----------------------------------------
  // Agent absorbs Instance: a single agents.create call
  // provisions the runnable resource. Stage 1 discriminates by TRPCError
  // code. Definitive rejections (ROLLBACK_CODES) mean the resource was
  // never created, so deleting what *we* created is safe; ambiguous
  // codes (INTERNAL_SERVER_ERROR, network) may leave real state behind,
  // so we don't auto-delete — we surface a hint and let the user
  // inspect.
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

  // --- Step 6: grant credentials ------------------------------------
  // Past this point we have a real agent on the server. Stage 2
  // (granting credentials) NEVER rolls back — the agent is user state
  // and may have value even without a grant. The retry bridges the
  // K8s-API visibility race for the just-created agent ConfigMap
  // (matches the web UI's 5×/2s wait); if it exhausts, we surface a
  // hint pointing the user at the UI.
  //
  // Connection grants and legacy-secret grants go through different calls;
  // both are idempotent full replaces, so the retry can safely re-run both.
  spin.message("Granting credentials...");
  const connectionIds: string[] = [];
  const secretIds: string[] = [];
  if (provider.routing.kind === "connection") {
    connectionIds.push(provider.routing.id);
  } else {
    secretIds.push(provider.routing.id);
  }
  if (githubPat) {
    if (githubPat.source === "connection") {
      connectionIds.push(githubPat.connectionId);
    } else {
      secretIds.push(githubPat.apiSecretId, githubPat.gitSecretId);
    }
  }
  try {
    await withRetry(async () => {
      if (connectionIds.length > 0) {
        await trpc.connections.setAgentConnections.mutate({
          agentId: cleanup.agentId!,
          connectionIds,
        });
      }
      if (secretIds.length > 0) {
        await trpc.secrets.setAgentAccess.mutate({
          agentId: cleanup.agentId!,
          secretIds,
        });
      }
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

  // --- Step 7: wait for running --------------------------------------
  // Past this point we have a real agent + grants on the server.
  // Failures from here on do NOT trigger rollback — the user can
  // inspect/clean up via `dam agent get` / `dam agent delete`.
  spin.message(`Waiting for agent to start (state: ${agent.state})...`);
  const svc = deps.createAgentService(host);

  // SIGINT during the wait: stop the spinner, point at the live agent,
  // exit non-zero. Don't rollback — the user chose to interrupt; the
  // agent's existence is their call from here. The handler runs once;
  // we remove it on natural wait completion to restore default behavior.
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
      // The agent exists server-side; the pod is just slow. Per spec:
      // warn and exit 0. The user can check progress with
      // `dam agent get`.
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

/**
 * Cancel path for prompts that run after a picker has already created a
 * new connection. Best-effort cleanup of anything tracked in the ledger
 * before exiting — without this a user who hits Ctrl+C between provider
 * and GitHub steps would leak the just-created provider connection.
 *
 * Exits 0 (cancel is a user action, not an error).
 */
async function cancelAndCleanup(
  trpc: TrpcClient,
  cleanup: Cleanup,
): Promise<never> {
  cancel("Cancelled");
  await flushCleanup(trpc, cleanup);
  process.exit(0);
}

/**
 * Best-effort tear-down of everything in the ledger, surfacing whatever
 * we couldn't delete as a warning. Shared by the cancel-path
 * (`cancelAndCleanup`) and the stage-1 rollback path (`handleStage1Failure`
 * on a definitive TRPCError).
 */
async function flushCleanup(trpc: TrpcClient, cleanup: Cleanup): Promise<void> {
  if (cleanup.agentId === null && cleanup.newConnectionIds.length === 0) return;
  const { orphanAgent, orphanConnections } = await deleteCreated(trpc, cleanup);
  const summary = formatOrphans(orphanAgent, orphanConnections);
  if (summary) log.warn(summary);
}

/**
 * Stage 1 (agents.create) failure handler.
 *
 * Discriminates by TRPCError code via `classifyFailure`: definitive
 * codes mean the server rejected the mutation outright and any resource
 * we created is safe to tear down. Ambiguous codes (INTERNAL_SERVER_ERROR,
 * transport) may mean the mutation actually succeeded server-side, so
 * we keep our hands off real state and surface what we know about — the
 * user inspects via the web UI.
 */
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

  // Ambiguous outcome — agent may or may not have been created
  // server-side. Don't delete anything; just tell the user what we
  // tried to create so they can investigate.
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
  routing: { kind: "connection"; id: string } | { kind: "secret"; id: string };
  name: string;
  type: string;
}

interface ExistingProviderConn {
  id: string;
  name: string;
  templateId: string;
  type: ProviderPresetType;
}

interface ExistingProviderSecret {
  id: string;
  name: string;
  type: ProviderPresetType;
}

/**
 * Lists connections and legacy secrets together — both pickers dual-read the
 * two surfaces during the #1273 transition. A list failure is fatal: cancel,
 * flush the rollback ledger, and exit.
 */
async function listCredentials(trpc: TrpcClient, cleanup: Cleanup) {
  try {
    return {
      conns: await trpc.connections.list.query(),
      secrets: await trpc.secrets.list.query(),
    };
  } catch (e) {
    cancel(`failed to list credentials: ${errorReason(e)}`);
    await flushCleanup(trpc, cleanup);
    process.exit(EXIT_RUNTIME_FAILURE);
  }
}

/**
 * Provider step. Offers existing provider connections plus legacy provider
 * secrets (dual-read), or "Add new..." which always creates a connection.
 * Singleton-per-type: adding a provider whose type already has a connection
 * offers to replace its credential instead.
 */
async function pickProvider(
  trpc: TrpcClient,
  cleanup: Cleanup,
): Promise<ProviderSelection> {
  const { conns, secrets } = await listCredentials(trpc, cleanup);

  const existingConns = providerConns(conns);
  const existingSecrets: ExistingProviderSecret[] = secrets
    .filter((s): s is typeof s & { type: ProviderPresetType } =>
      isProviderPresetType(s.type),
    )
    .map((s) => ({ id: s.id, name: s.name, type: s.type }));

  if (existingConns.length === 0 && existingSecrets.length === 0) {
    log.info("No model providers configured yet — let's add one.");
    return addOrReplaceProvider(trpc, cleanup, existingConns);
  }

  const NEW = "__new__";
  const picked = await select<string>({
    message: "Model provider",
    options: [
      ...existingConns.map((c) => ({
        value: `conn:${c.id}`,
        label: `${c.name} (${c.type})`,
      })),
      ...existingSecrets.map((s) => ({
        value: `secret:${s.id}`,
        label: `${s.name} (${s.type}) (legacy)`,
      })),
      { value: NEW, label: "Add new..." },
    ],
  });
  if (isCancel(picked)) return cancelAndCleanup(trpc, cleanup);

  if (picked === NEW) return addOrReplaceProvider(trpc, cleanup, existingConns);

  if (picked.startsWith("conn:")) {
    const found = existingConns.find((c) => `conn:${c.id}` === picked)!;
    return {
      routing: { kind: "connection", id: found.id },
      name: found.name,
      type: found.type,
    };
  }
  const found = existingSecrets.find((s) => `secret:${s.id}` === picked)!;
  return {
    routing: { kind: "secret", id: found.id },
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
): Promise<ProviderSelection> {
  // Loops on server-side create/update failures — re-types the type prompt
  // rather than preserving prior input; the prompts are short.
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
      // Singleton-per-type. Default to NOT replacing — overwriting a working
      // credential is the destructive option; the user has to opt in.
      const replace = await confirm({
        message: `A ${PROVIDERS[type].displayName} connection already exists. Replace its credential?`,
        initialValue: false,
      });
      if (isCancel(replace)) return cancelAndCleanup(trpc, cleanup);

      if (!replace) {
        return {
          routing: { kind: "connection", id: existingOfType.id },
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
          routing: { kind: "connection", id: existingOfType.id },
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

    const created = await createProviderConnection(
      trpc,
      cleanup,
      type,
      templateIdForProvider(type, value),
      value,
    );
    if (created) return created;
    // Fall through to next loop iteration on a non-recoverable create error.
  }
}

/**
 * Creates a header connection, re-prompting for a fresh name on CONFLICT
 * until it succeeds or the user cancels. Tracks the new id in the rollback
 * ledger immediately so a later cancel/throw can't orphan it. Returns the
 * created `{ id, name }`, or `null` on a non-recoverable create error — the
 * caller decides what to re-prompt (provider type vs. token).
 */
async function createConnectionWithRename(
  trpc: TrpcClient,
  cleanup: Cleanup,
  params: {
    templateId: string;
    name: string;
    value: string;
    nameExample: string;
  },
): Promise<{ id: string; name: string } | null> {
  let name = params.name;
  while (true) {
    try {
      const created = await trpc.connections.create.mutate({
        templateId: params.templateId,
        name,
        authKind: "header",
        value: params.value,
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

// Returns null on a non-recoverable create error so the caller re-prompts the
// provider type.
async function createProviderConnection(
  trpc: TrpcClient,
  cleanup: Cleanup,
  type: ProviderPresetType,
  templateId: string,
  value: string,
): Promise<ProviderSelection | null> {
  const created = await createConnectionWithRename(trpc, cleanup, {
    templateId,
    name: templateId,
    value,
    nameExample: "my-anthropic",
  });
  if (!created) return null;
  return {
    routing: { kind: "connection", id: created.id },
    name: created.name,
    type,
  };
}

type GithubSelection =
  | { source: "connection"; connectionId: string; name: string }
  | {
      source: "secret";
      apiSecretId: string;
      gitSecretId: string;
      name: string;
    };

// Default name for a new GitHub PAT connection (kebab-valid).
const DEFAULT_GITHUB_PAT_NAME = GITHUB_PAT_TEMPLATE_ID;

/**
 * Optional GitHub PAT step (returns null if skipped). New setup creates a
 * single `github-pat` connection; legacy twin-secret PATs are dual-read so
 * they stay grantable.
 */
async function pickGithubPat(
  trpc: TrpcClient,
  cleanup: Cleanup,
): Promise<GithubSelection | null> {
  const { conns, secrets } = await listCredentials(trpc, cleanup);
  const patConns = conns.filter((c) => c.templateId === GITHUB_PAT_TEMPLATE_ID);
  const pairs = groupGithubPats(secrets);

  if (patConns.length === 0 && pairs.length === 0) {
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
      ...pairs.map((p) => ({
        value: `secret:${p.name}`,
        label: `${p.name} (legacy)`,
      })),
      { value: NEW, label: "Add new..." },
      { value: SKIP, label: "Skip" },
    ],
  });
  if (isCancel(picked)) return cancelAndCleanup(trpc, cleanup);
  if (picked === SKIP) return null;
  if (picked === NEW) return addOrReplaceGithubPat(trpc, cleanup, patConns);

  if (picked.startsWith("conn:")) {
    const found = patConns.find((c) => `conn:${c.id}` === picked)!;
    return { source: "connection", connectionId: found.id, name: found.name };
  }
  const found = pairs.find((p) => `secret:${p.name}` === picked)!;
  return {
    source: "secret",
    apiSecretId: found.apiSecretId,
    gitSecretId: found.gitSecretId,
    name: found.name,
  };
}

async function addOrReplaceGithubPat(
  trpc: TrpcClient,
  cleanup: Cleanup,
  existing: readonly ConnectionView[],
): Promise<GithubSelection> {
  // Singleton-by-default-name: if a github-pat connection named
  // DEFAULT_GITHUB_PAT_NAME already exists, offer to replace its token.
  // Default to NOT replacing — overwriting a working token is destructive.
  const collide = existing.find((c) => c.name === DEFAULT_GITHUB_PAT_NAME);

  while (true) {
    if (collide) {
      const replace = await confirm({
        message: `A GitHub PAT connection named "${DEFAULT_GITHUB_PAT_NAME}" already exists. Replace its token?`,
        initialValue: false,
      });
      if (isCancel(replace)) return cancelAndCleanup(trpc, cleanup);

      if (!replace) {
        return {
          source: "connection",
          connectionId: collide.id,
          name: collide.name,
        };
      }

      const token = await promptSecret("New GitHub personal access token");
      if (isCancel(token)) return cancelAndCleanup(trpc, cleanup);

      try {
        await trpc.connections.update.mutate({ id: collide.id, value: token });
        return {
          source: "connection",
          connectionId: collide.id,
          name: collide.name,
        };
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
      return {
        source: "connection",
        connectionId: created.id,
        name: created.name,
      };
    }
    // Non-recoverable create error: loop re-prompts the token.
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
      // Definitive rejections (the server made up its mind) — retrying
      // burns ~8s behind a spinner for no chance of success. The
      // visibility-race that motivates the retry surfaces as
      // INTERNAL_SERVER_ERROR / transport failure, not these codes.
      if (classifyFailure(e) === "rollback") throw e;
      if (attempt === maxAttempts - 1) throw e;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  // Unreachable — loop either returns or throws on the last attempt.
  throw new Error("withRetry: exhausted attempts");
}

function errorReason(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return "unknown failure";
}
