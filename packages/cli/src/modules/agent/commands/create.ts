import { cancel, confirm, intro, isCancel, log, note, outro, password, select, spinner, text } from "@clack/prompts";
import { Command } from "commander";
import { PROVIDERS, type Instance } from "api-server-api";
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
import { groupGithubPats, type GithubPatPair } from "../lib/group-github-pats.js";

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
    cancel(
      `CLI ${verdict.localCli} is below the server's minimum required version ${verdict.serverMinClient}; upgrade and retry`,
    );
    process.exit(EXIT_INSTANCE_BELOW_FLOOR);
  }
  if (verdict.kind === "behind-current") {
    log.warn(
      `CLI ${verdict.localCli} is behind server ${verdict.serverVersion}; consider upgrading`,
    );
  }

  const cfg = await deps.configService.getResolved({ flag });
  if (!cfg.ok) {
    cancel(describeConfigError(cfg.error));
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
      cancel(`not authenticated: ${tmplResult.error.reason}\nhint: run \`dam auth login\` first`);
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

  // --- Step 3: model provider ---------------------------------------
  const trpc = deps.createTrpcClient(host);
  const provider = await pickProvider(trpc);

  // --- Step 4: optional GitHub PAT ----------------------------------
  const githubPat = await pickGithubPat(trpc);

  // --- Rollback bookkeeping ------------------------------------------
  // Anything created during *this* run goes here so a downstream
  // mutation failure can clean it up. Existing secrets that the user
  // picked or replaced stay out: a replace-existing path overwrote the
  // value in place and the old value isn't recoverable, so rollback
  // would be destructive.
  const cleanup: Cleanup = { newSecretIds: [], agentId: null };
  if (provider.createdNew) cleanup.newSecretIds.push(provider.secretId);
  if (githubPat?.createdNew) {
    cleanup.newSecretIds.push(githubPat.apiSecretId, githubPat.gitSecretId);
  }

  // --- Steps 5 + 6 + 7: agents.create → instances.create → setAgentAccess ---
  // Grants live as `granted-secret-ids` annotations on the *instance*
  // ConfigMap, not the agent. setAgentAccess before any instance exists
  // is a silent no-op, so the order has to be: agent → instance → grant.
  // Mirrors `useCreateAgent` in packages/ui/src/modules/agents/api/mutations.ts.
  // The grant lands after pod boot and the controller rolls the pod
  // once to pick it up.
  const spin = spinner();
  spin.start("Creating agent...");

  let instance: Instance;
  try {
    const agent = await trpc.agents.create.mutate({ name, templateId });
    cleanup.agentId = agent.id;

    spin.message("Creating instance...");
    instance = await trpc.instances.create.mutate({ name, agentId: agent.id });

    spin.message("Granting provider access...");
    // Retry — the just-created instance ConfigMap may not yet be visible
    // to the api-server's listConfigMaps when setAgentAccess fires; without
    // the retry the patch silently targets zero ConfigMaps and the grant
    // is lost. Matches the web UI's 5× / 2s wait.
    const grantedIds = [provider.secretId];
    if (githubPat) grantedIds.push(githubPat.apiSecretId, githubPat.gitSecretId);
    await withRetry(() =>
      trpc.secrets.setAgentAccess.mutate({
        agentId: agent.id,
        secretIds: grantedIds,
      }),
    );
  } catch (e) {
    spin.stop("Setup failed");
    await rollback(trpc, cleanup, errorReason(e));
    process.exit(EXIT_INSTANCE_RUNTIME_FAILURE);
  }

  // --- Step 8: wait for running --------------------------------------
  // Past this point we have a real agent + instance + grants on the
  // server. Failures from here on do NOT trigger rollback — the user
  // can inspect/clean up via `dam instance get` / `dam instance delete`.
  spin.message(`Waiting for instance to start (state: ${instance.state})...`);
  const svc = deps.createInstanceService(host);

  // SIGINT during the wait: stop the spinner, point at the live agent,
  // exit non-zero. Don't rollback — the user chose to interrupt; the
  // agent's existence is their call from here. The handler runs once;
  // we remove it on natural wait completion to restore default behavior.
  const onSigint = () => {
    spin.stop("Cancelled");
    log.warn(`Agent ${name} already exists; delete with \`dam instance delete ${name}\` if not needed.`);
    process.exit(EXIT_INSTANCE_RUNTIME_FAILURE);
  };
  process.once("SIGINT", onSigint);

  let waitResult;
  try {
    waitResult = await waitForRunning(svc, instance.id, {
      timeoutSeconds: WAIT_TIMEOUT_SECONDS,
      graceSeconds: 0,
      onStateChange: (state) => {
        spin.message(`Waiting for instance to start (state: ${state})...`);
      },
    });
  } finally {
    process.removeListener("SIGINT", onSigint);
  }

  switch (waitResult.kind) {
    case "ready": {
      spin.stop("Instance running");
      const lines = [
        `✓ Agent created: ${name}`,
        `✓ Provider: ${provider.name} (${provider.type})`,
        ...(githubPat ? [`✓ GitHub: ${githubPat.name}`] : []),
        `→ Next: dam chat ${name}`,
      ];
      outro(lines.join("\n"));
      process.exit(EXIT_INSTANCE_SUCCESS);
      return;
    }
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

function cancelAndExit(): never {
  cancel("Cancelled");
  process.exit(0);
}

interface Cleanup {
  /** Secret IDs created during this run (S1 + both halves of S2). */
  newSecretIds: string[];
  /** Set once agents.create has returned an id. Cascade-deletes the
   *  instance and its grants via the K8s OwnerReference chain when
   *  passed to agents.delete. */
  agentId: string | null;
}

/**
 * Reverse anything we created in this run after a downstream mutation
 * blew up. Deletes the agent first (cascade tears down the instance
 * via OwnerReferences), then any new secrets. Whatever fails to delete
 * gets surfaced as an orphan summary so the user knows what to clean
 * up manually.
 *
 * One pass — we don't retry rollback. If the api-server is down, the
 * orphan list is the best we can do.
 */
async function rollback(
  trpc: TrpcClient,
  cleanup: Cleanup,
  originalError: string,
): Promise<void> {
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

  log.error(`Failed to create agent: ${originalError}`);
  if (orphanAgent || orphanSecrets.length > 0) {
    const lines = ["Cleanup partially failed. Manual cleanup needed:"];
    if (orphanAgent) {
      lines.push(`  Agent: ${orphanAgent} (delete via web UI or \`dam instance delete\`)`);
    }
    if (orphanSecrets.length > 0) {
      lines.push(`  Secrets: ${orphanSecrets.join(", ")} (delete via web UI's secrets page)`);
    }
    log.error(lines.join("\n"));
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
async function pickProvider(trpc: TrpcClient): Promise<ProviderSelection> {
  let list;
  try {
    list = await trpc.secrets.list.query();
  } catch (e) {
    cancel(`failed to list secrets: ${errorReason(e)}`);
    process.exit(EXIT_INSTANCE_RUNTIME_FAILURE);
  }
  const existing: ExistingProvider[] = list
    .filter(
      (s): s is typeof s & { type: ProviderType } =>
        s.type === "anthropic" || s.type === "ibm-litellm" || s.type === "openai",
    )
    .map((s) => ({ id: s.id, name: s.name, type: s.type }));

  if (existing.length === 0) {
    log.info("No model providers configured yet — let's add one.");
    return addOrReplaceProvider(trpc, existing);
  }

  const NEW = "__new__";
  const picked = await select<string>({
    message: "Model provider",
    options: [
      ...existing.map((s) => ({ value: s.id, label: `${s.name} (${s.type})` })),
      { value: NEW, label: "Add new..." },
    ],
  });
  if (isCancel(picked)) cancelAndExit();

  if (picked === NEW) return addOrReplaceProvider(trpc, existing);

  const found = existing.find((s) => s.id === picked);
  if (!found) {
    // Defensive — `picked` was sourced from `existing`. If we ever hit
    // this it means the picker handed us something unexpected.
    cancel("internal: picked provider not in list");
    process.exit(EXIT_INSTANCE_RUNTIME_FAILURE);
  }
  return { secretId: found.id, name: found.name, type: found.type, createdNew: false };
}

async function addOrReplaceProvider(
  trpc: TrpcClient,
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
    if (isCancel(type)) cancelAndExit();

    const existingOfType = existing.find((s) => s.type === type);

    if (existingOfType) {
      // Singleton-per-type. Default to NOT replacing — overwriting a
      // working key is the destructive option; the user has to opt in.
      const replace = await confirm({
        message: `A ${PROVIDERS[type].displayName} key already exists. Replace its API key?`,
        initialValue: false,
      });
      if (isCancel(replace)) cancelAndExit();

      if (!replace) {
        return { secretId: existingOfType.id, name: existingOfType.name, type, createdNew: false };
      }

      const apiKey = await password({
        message: `New ${PROVIDERS[type].displayName} API key`,
        validate(v) {
          if (!v || v.trim() === "") return "Required";
          return undefined;
        },
      });
      if (isCancel(apiKey)) cancelAndExit();

      try {
        await trpc.secrets.update.mutate({ id: existingOfType.id, value: apiKey });
        return { secretId: existingOfType.id, name: existingOfType.name, type, createdNew: false };
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
    if (isCancel(apiKey)) cancelAndExit();

    try {
      const created = await trpc.secrets.create.mutate({ type, name, value: apiKey });
      return { secretId: created.id, name: created.name, type, createdNew: true };
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
async function pickGithubPat(trpc: TrpcClient): Promise<GithubSelection | null> {
  let list;
  try {
    list = await trpc.secrets.list.query();
  } catch (e) {
    cancel(`failed to list secrets: ${errorReason(e)}`);
    process.exit(EXIT_INSTANCE_RUNTIME_FAILURE);
  }
  const pairs = groupGithubPats(list);

  if (pairs.length === 0) {
    log.info("No GitHub PAT configured yet.");
    const add = await confirm({ message: "Add one?", initialValue: true });
    if (isCancel(add)) cancelAndExit();
    if (!add) return null;
    return addOrReplaceGithubPat(trpc, pairs);
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
  if (isCancel(picked)) cancelAndExit();
  if (picked === SKIP) return null;
  if (picked === NEW) return addOrReplaceGithubPat(trpc, pairs);

  const found = pairs.find((p) => p.name === picked);
  if (!found) {
    cancel("internal: picked PAT not in list");
    process.exit(EXIT_INSTANCE_RUNTIME_FAILURE);
  }
  return { ...found, createdNew: false };
}

// Default display name baked into new PATs — mirrors the providers
// pattern of using a fixed label so the user can paste a token and
// move on. Renaming for multi-account setups stays in the web UI.
const DEFAULT_GITHUB_PAT_NAME = "GitHub";

async function addOrReplaceGithubPat(
  trpc: TrpcClient,
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
      if (isCancel(replace)) cancelAndExit();

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
      if (isCancel(token)) cancelAndExit();

      try {
        await trpc.secrets.updateGithubPat.mutate({
          apiSecretId: collide.apiSecretId,
          gitSecretId: collide.gitSecretId,
          token,
        });
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
    if (isCancel(token)) cancelAndExit();

    try {
      const created = await trpc.secrets.createGithubPat.mutate({
        name: DEFAULT_GITHUB_PAT_NAME,
        token,
      });
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
