import {
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  note,
  outro,
  password,
  select,
  spinner,
  text,
} from "@clack/prompts";
import { Command } from "commander";
import {
  agentCreateInputSchema,
  PROVIDERS,
  secretCreateGithubPatInputSchema,
  secretCreateInputSchema,
  secretUpdateGithubPatInputSchema,
  secretUpdateInputSchema,
} from "api-server-api";
import type { CompatService, ConfigService } from "../../cli/index.js";
import type { AgentService } from "../services/agent-service.js";
import type { AgentView } from "../domain/agent-view.js";
import { validateAgentName } from "./create-helpers.js";
import { formatTransportError } from "./errors.js";
import { parseOrExit } from "../../shared/parse-or-exit.js";
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
  /** Secret IDs created during this run (provider + both halves of any
   *  new GitHub PAT pair). */
  newSecretIds: string[];
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
 * secrets. Whatever fails to delete is returned as orphan info so the
 * caller can surface it. One pass — if the api-server is down, the orphan
 * list is the best we can do.
 */
async function deleteCreated(
  trpc: TrpcClient,
  cleanup: Cleanup,
): Promise<{ orphanAgent: string | null; orphanSecrets: string[] }> {
  let orphanAgent: string | null = null;
  const orphanSecrets: string[] = [];
  if (cleanup.agentId) {
    try {
      await trpc.agents.delete.mutate({ id: cleanup.agentId });
    } catch {
      orphanAgent = cleanup.agentId;
    }
  }
  for (const id of cleanup.newSecretIds) {
    try {
      await trpc.secrets.delete.mutate({ id });
    } catch {
      orphanSecrets.push(id);
    }
  }
  return { orphanAgent, orphanSecrets };
}

function formatOrphans(
  orphanAgent: string | null,
  orphanSecrets: readonly string[],
): string | null {
  if (!orphanAgent && orphanSecrets.length === 0) return null;
  const lines = ["Cleanup partially failed. Manual cleanup needed:"];
  if (orphanAgent) {
    lines.push(
      `  Agent: ${orphanAgent} (delete via web UI or \`dam agent delete\`)`,
    );
  }
  if (orphanSecrets.length > 0) {
    lines.push(
      `  Secrets: ${orphanSecrets.join(", ")} (delete via web UI's secrets page)`,
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
  // secrets that the user picked or replaced stay out: a replace-
  // existing path overwrote the value in place and the old value isn't
  // recoverable, so rollback would be destructive.
  const trpc = deps.createTrpcClient(host);
  const cleanup: Cleanup = { newSecretIds: [], agentId: null };

  // --- Step 3: model provider ---------------------------------------
  const provider = await pickProvider(trpc, cleanup);

  // --- Step 4: optional GitHub PAT ----------------------------------
  const githubPat = await pickGithubPat(trpc, cleanup);

  // --- Step 5: agents.create ----------------------------------------
  // Per ADR-046, Agent absorbs Instance: a single agents.create call
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

  // --- Step 6: setAgentAccess ---------------------------------------
  // Past this point we have a real agent on the server. Stage 2
  // (granting provider access) NEVER rolls back — the agent is user
  // state and may have value even without a grant. The retry bridges
  // the K8s-API visibility race for the just-created agent ConfigMap
  // (matches the web UI's 5×/2s wait); if it exhausts, we surface a
  // hint pointing the user at the UI.
  spin.message("Granting provider access...");
  const grantedIds = [provider.secretId];
  // PAT halves grant individually — the Bob preset (PR #225) routes its
  // twins through `primarySecretId` expansion server-side, but PATs lack
  // that field and stay paired only by shared `name`. If PATs ever migrate
  // to the twin-secret model, drop the second push: passing `apiSecretId`
  // alone will expand to both.
  if (githubPat) grantedIds.push(githubPat.apiSecretId, githubPat.gitSecretId);
  try {
    await withRetry(() =>
      trpc.secrets.setAgentAccess.mutate({
        agentId: cleanup.agentId!,
        secretIds: grantedIds,
      }),
    );
  } catch (e) {
    spin.stop("Grant failed");
    log.error(`Failed to grant provider access: ${errorReason(e)}`);
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
 * new secret. Best-effort cleanup of anything tracked in the ledger
 * before exiting — without this a user who hits Ctrl+C between provider
 * and GitHub steps would leak the just-created provider secret.
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
  if (cleanup.agentId === null && cleanup.newSecretIds.length === 0) return;
  const { orphanAgent, orphanSecrets } = await deleteCreated(trpc, cleanup);
  const summary = formatOrphans(orphanAgent, orphanSecrets);
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
  if (cleanup.newSecretIds.length > 0) {
    lines.push(`  Secrets: ${cleanup.newSecretIds.join(", ")}`);
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

type ProviderType = "anthropic" | "ibm-litellm" | "openai";

interface ProviderSelection {
  secretId: string;
  name: string;
  type: ProviderType;
  /** True when this run created the secret (eligible for rollback if a
   *  later mutation fails). False for picked-existing and for replace-
   *  existing — in the latter the secret was overwritten in place, but
   *  the old value isn't recoverable so rollback would be destructive. */
  createdNew: boolean;
}

type ExistingProvider = { id: string; name: string; type: ProviderType };

/**
 * Provider step. Lists existing Anthropic / IBM LiteLLM / OpenAI secrets
 * so the user can grant one (or add a new one inline). The server's
 * `PROVIDERS` preset fills in host / header / env defaults — the CLI
 * only sends `{ type, name, value }` to `secrets.create`.
 *
 * Singleton-per-type — when the user picks "Add new..." for a type that
 * already exists, the sub-flow offers to replace its API key instead of
 * creating a duplicate. Matches the web UI's provider cards.
 *
 * Anthropic is API-key only — the OAuth flow stays in the web UI.
 */
async function pickProvider(
  trpc: TrpcClient,
  cleanup: Cleanup,
): Promise<ProviderSelection> {
  let list;
  try {
    list = await trpc.secrets.list.query();
  } catch (e) {
    cancel(`failed to list secrets: ${errorReason(e)}`);
    await flushCleanup(trpc, cleanup);
    process.exit(EXIT_RUNTIME_FAILURE);
  }
  const existing: ExistingProvider[] = list
    .filter(
      (s): s is typeof s & { type: ProviderType } =>
        s.type === "anthropic" ||
        s.type === "ibm-litellm" ||
        s.type === "openai",
    )
    .map((s) => ({ id: s.id, name: s.name, type: s.type }));

  if (existing.length === 0) {
    log.info("No model providers configured yet — let's add one.");
    return addOrReplaceProvider(trpc, cleanup, existing);
  }

  const NEW = "__new__";
  const picked = await select<string>({
    message: "Model provider",
    options: [
      ...existing.map((s) => ({ value: s.id, label: `${s.name} (${s.type})` })),
      { value: NEW, label: "Add new..." },
    ],
  });
  if (isCancel(picked)) return cancelAndCleanup(trpc, cleanup);

  if (picked === NEW) return addOrReplaceProvider(trpc, cleanup, existing);

  const found = existing.find((s) => s.id === picked);
  if (!found) {
    // Defensive — `picked` was sourced from `existing`. If we ever hit
    // this it means the picker handed us something unexpected.
    cancel("internal: picked provider not in list");
    await flushCleanup(trpc, cleanup);
    process.exit(EXIT_RUNTIME_FAILURE);
  }
  return {
    secretId: found.id,
    name: found.name,
    type: found.type,
    createdNew: false,
  };
}

async function addOrReplaceProvider(
  trpc: TrpcClient,
  cleanup: Cleanup,
  existing: readonly ExistingProvider[],
): Promise<ProviderSelection> {
  // Loops on server-side create/update failures (F1 from the spec) —
  // re-types the type prompt rather than preserving prior input; three
  // prompts is short enough that re-typing isn't painful.
  while (true) {
    const type = await select<ProviderType>({
      message: "Provider type",
      options: [
        { value: "anthropic", label: "Anthropic" },
        { value: "ibm-litellm", label: "IBM LiteLLM" },
        { value: "openai", label: "OpenAI" },
      ],
    });
    if (isCancel(type)) return cancelAndCleanup(trpc, cleanup);

    const existingOfType = existing.find((s) => s.type === type);

    if (existingOfType) {
      // Singleton-per-type. Default to NOT replacing — overwriting a
      // working key is the destructive option; the user has to opt in.
      const replace = await confirm({
        message: `A ${PROVIDERS[type].displayName} key already exists. Replace its API key?`,
        initialValue: false,
      });
      if (isCancel(replace)) return cancelAndCleanup(trpc, cleanup);

      if (!replace) {
        return {
          secretId: existingOfType.id,
          name: existingOfType.name,
          type,
          createdNew: false,
        };
      }

      const apiKey = await password({
        message: `New ${PROVIDERS[type].displayName} API key`,
        validate(v) {
          if (!v || v.trim() === "") return "Required";
          return undefined;
        },
      });
      if (isCancel(apiKey)) return cancelAndCleanup(trpc, cleanup);

      const updateInput = await parseOrExit(
        secretUpdateInputSchema,
        { id: existingOfType.id, value: apiKey },
        EXIT_INVALID_INPUT,
        () => flushCleanup(trpc, cleanup),
      );
      try {
        await trpc.secrets.update.mutate(updateInput);
        return {
          secretId: existingOfType.id,
          name: existingOfType.name,
          type,
          createdNew: false,
        };
      } catch (e) {
        log.error(`Failed to replace API key: ${errorReason(e)}`);
        continue;
      }
    }

    // Match the web UI's provider cards: auto-name the secret with the
    // preset's displayName ("Anthropic", "IBM LiteLLM ETE Proxy", "OpenAI")
    // instead of asking the user. Lets the user paste a key and move on.
    const name = PROVIDERS[type].displayName;

    const apiKey = await password({
      message: `${PROVIDERS[type].displayName} API key`,
      validate(v) {
        if (!v || v.trim() === "") return "Required";
        return undefined;
      },
    });
    if (isCancel(apiKey)) return cancelAndCleanup(trpc, cleanup);

    const createInput = await parseOrExit(
      secretCreateInputSchema,
      { type, name, value: apiKey },
      EXIT_INVALID_INPUT,
      () => flushCleanup(trpc, cleanup),
    );
    try {
      const created = await trpc.secrets.create.mutate(createInput);
      // Track immediately so any cancel/throw between here and runCreate
      // reaching the rollback ledger doesn't orphan the new secret.
      cleanup.newSecretIds.push(created.id);
      return {
        secretId: created.id,
        name: created.name,
        type,
        createdNew: true,
      };
    } catch (e) {
      log.error(`Failed to create secret: ${errorReason(e)}`);
      // Fall through to next loop iteration.
    }
  }
}

interface GithubSelection extends GithubPatPair {
  /** True only when both halves were created during this run. */
  createdNew: boolean;
}

/**
 * Optional GitHub PAT step. Returns `null` if the user skipped.
 *
 * A PAT lives server-side as two `generic` secrets sharing a `name` —
 * one for `api.github.com` (Bearer / `gh` CLI / `GH_TOKEN` env), one
 * for `github.com` (Basic / `git clone`). `groupGithubPats` filters
 * `secrets.list()` down to fully-paired entries, hiding orphans the
 * user can't actually grant.
 */
async function pickGithubPat(
  trpc: TrpcClient,
  cleanup: Cleanup,
): Promise<GithubSelection | null> {
  let list;
  try {
    list = await trpc.secrets.list.query();
  } catch (e) {
    cancel(`failed to list secrets: ${errorReason(e)}`);
    await flushCleanup(trpc, cleanup);
    process.exit(EXIT_RUNTIME_FAILURE);
  }
  const pairs = groupGithubPats(list);

  if (pairs.length === 0) {
    log.info("No GitHub PAT configured yet.");
    const add = await confirm({ message: "Add one?", initialValue: true });
    if (isCancel(add)) return cancelAndCleanup(trpc, cleanup);
    if (!add) return null;
    return addOrReplaceGithubPat(trpc, cleanup, pairs);
  }

  const NEW = "__new__";
  const SKIP = "__skip__";
  const picked = await select<string>({
    message: "GitHub PAT",
    options: [
      ...pairs.map((p) => ({ value: p.name, label: p.name })),
      { value: NEW, label: "Add new..." },
      { value: SKIP, label: "Skip" },
    ],
  });
  if (isCancel(picked)) return cancelAndCleanup(trpc, cleanup);
  if (picked === SKIP) return null;
  if (picked === NEW) return addOrReplaceGithubPat(trpc, cleanup, pairs);

  const found = pairs.find((p) => p.name === picked);
  if (!found) {
    cancel("internal: picked PAT not in list");
    await flushCleanup(trpc, cleanup);
    process.exit(EXIT_RUNTIME_FAILURE);
  }
  return { ...found, createdNew: false };
}

// Default display name baked into new PATs — mirrors the providers
// pattern of using a fixed label so the user can paste a token and
// move on. Renaming for multi-account setups stays in the web UI.
const DEFAULT_GITHUB_PAT_NAME = "GitHub";

async function addOrReplaceGithubPat(
  trpc: TrpcClient,
  cleanup: Cleanup,
  existing: readonly GithubPatPair[],
): Promise<GithubSelection> {
  // Singleton-by-default-name: if a PAT named DEFAULT_GITHUB_PAT_NAME
  // already exists, offer to replace its token (mirrors the providers'
  // replace-existing flow). Default to NOT replacing — overwriting a
  // working token is the destructive option.
  const collide = existing.find((p) => p.name === DEFAULT_GITHUB_PAT_NAME);

  // Loop on `secrets.createGithubPat` / `secrets.updateGithubPat`
  // failure (F1 from the spec).
  while (true) {
    if (collide) {
      const replace = await confirm({
        message: `A GitHub PAT named "${DEFAULT_GITHUB_PAT_NAME}" already exists. Replace its token?`,
        initialValue: false,
      });
      if (isCancel(replace)) return cancelAndCleanup(trpc, cleanup);

      if (!replace) {
        return { ...collide, createdNew: false };
      }

      const token = await password({
        message: "New GitHub personal access token",
        validate(v) {
          if (!v || v.trim() === "") return "Required";
          return undefined;
        },
      });
      if (isCancel(token)) return cancelAndCleanup(trpc, cleanup);

      const updateInput = await parseOrExit(
        secretUpdateGithubPatInputSchema,
        {
          apiSecretId: collide.apiSecretId,
          gitSecretId: collide.gitSecretId,
          token,
        },
        EXIT_INVALID_INPUT,
        () => flushCleanup(trpc, cleanup),
      );
      try {
        await trpc.secrets.updateGithubPat.mutate(updateInput);
        return { ...collide, createdNew: false };
      } catch (e) {
        log.error(`Failed to replace GitHub PAT: ${errorReason(e)}`);
        continue;
      }
    }

    const token = await password({
      message: "GitHub personal access token",
      validate(v) {
        if (!v || v.trim() === "") return "Required";
        return undefined;
      },
    });
    if (isCancel(token)) return cancelAndCleanup(trpc, cleanup);

    const createInput = await parseOrExit(
      secretCreateGithubPatInputSchema,
      { name: DEFAULT_GITHUB_PAT_NAME, token },
      EXIT_INVALID_INPUT,
      () => flushCleanup(trpc, cleanup),
    );
    try {
      const created = await trpc.secrets.createGithubPat.mutate(createInput);
      // Track immediately so any cancel/throw between here and runCreate
      // reaching the rollback ledger doesn't orphan the new pair.
      cleanup.newSecretIds.push(created.apiSecretId, created.gitSecretId);
      return {
        name: created.name,
        apiSecretId: created.apiSecretId,
        gitSecretId: created.gitSecretId,
        createdNew: true,
      };
    } catch (e) {
      log.error(`Failed to create GitHub PAT: ${errorReason(e)}`);
      // Fall through to next loop iteration.
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
