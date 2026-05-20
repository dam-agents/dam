import { createHash, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  DEFAULT_ENV_PLACEHOLDER,
  isProviderPresetType,
  PROVIDERS,
  type SecretCreateGithubPatInput,
  type CreateGithubPatOutput,
  type EnvMapping,
  type InjectionConfig,
  type ProviderPreset,
  type ProviderPresetMode,
  type SecretsService,
  type SecretCreateInput,
  type SecretUpdateGithubPatInput,
  type UpdateGithubPatOutput,
  type SecretUpdateInput,
  type SecretType,
  type SecretView,
  type AgentAccess,
} from "api-server-api";
import type {
  AuthMode,
  K8sSecretsPort,
  K8sStoredSecret,
} from "./../infrastructure/k8s-secrets-port.js";
import type { AgentGrantsPort } from "../../agents/infrastructure/agent-grants-port.js";
import { hostPatternFor, pathPatternFor } from "../domain/types.js";

/**
 * Default env-var bundle for a provider preset+mode, sourced from the
 * registry. Returns `undefined` for generic secrets (the user declares
 * their own env). ADR-040: keeps non-UI clients (CLI, scripts) from
 * producing secrets the controller can't merge into agent pod env.
 */
function registryEnvMappings(
  type: SecretType,
  authMode?: string,
): EnvMapping[] | undefined {
  if (type === "generic") return undefined;
  const preset: ProviderPreset = PROVIDERS[type];
  // Anthropic has 2 modes — picked by the value-prefix discriminator
  // (authMode). Other presets have exactly one mode.
  const mode: ProviderPresetMode | undefined = authMode
    ? preset.modes.find((m) => m.key === authMode)
    : preset.modes[0];
  return mode?.defaultEnvMappings;
}

function registryExtraInjections(
  type: SecretType,
  authMode?: string,
): readonly InjectionConfig[] {
  if (type === "generic") return [];
  const preset: ProviderPreset = PROVIDERS[type];
  const mode: ProviderPresetMode | undefined = authMode
    ? preset.modes.find((m) => m.key === authMode)
    : preset.modes[0];
  return mode?.extraInjections ?? [];
}

function twinDisplayName(
  primaryName: string,
  injection: InjectionConfig,
): string {
  const tag = injection.queryParamName
    ? `?${injection.queryParamName}`
    : injection.headerName;
  return `${primaryName} (${tag})`;
}

/**
 * Anthropic-only: if the new value's prefix indicates a different auth
 * mode than the secret currently has, return the registry's env
 * mappings for the new mode plus the new mode key. `update` uses this
 * to re-bake injection + env when a CLI replace path swaps key formats.
 * Returns `null` when no rotation is needed (non-Anthropic secret,
 * same mode, or secret not found — the K8sPort will surface NOT_FOUND
 * downstream).
 */
async function anthropicModeRotationFor(
  k8sPort: K8sSecretsPort,
  id: string,
  newValue: string,
): Promise<{ authMode: AuthMode; envMappings: EnvMapping[] } | null> {
  const secrets = await k8sPort.listSecrets();
  const existing = secrets.find((s) => s.id === id);
  if (!existing || existing.type !== "anthropic") return null;
  const newAuthMode: AuthMode = newValue.startsWith("sk-ant-oat")
    ? "oauth"
    : "api-key";
  if (newAuthMode === existing.authMode) return null;
  const mode = PROVIDERS.anthropic.modes.find((m) => m.key === newAuthMode);
  if (!mode) return null;
  return { authMode: newAuthMode, envMappings: [...mode.defaultEnvMappings] };
}

// `secrets-rev` hashes only what affects the agent pod's env. hostPattern,
// pathPattern, and injectionConfig are gateway-side and have their own roll
// trigger (envoy-secrets-rev on the gateway StatefulSet); rolling the agent
// pod for them would be gratuitous. ADR-040 §Fanout: host edits hot, env
// edits roll.
function combinedSecretsRev(
  grantedSecrets: readonly K8sStoredSecret[],
): string {
  const data = [...grantedSecrets]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((s) => ({ id: s.id, envMappings: s.envMappings ?? [] }));
  return createHash("sha256")
    .update(JSON.stringify(data))
    .digest("hex")
    .slice(0, 16);
}

function envMappingsChanged(
  before: K8sStoredSecret,
  after: K8sStoredSecret,
): boolean {
  return (
    JSON.stringify(before.envMappings ?? []) !==
    JSON.stringify(after.envMappings ?? [])
  );
}

function hostOrPathChanged(
  before: K8sStoredSecret,
  after: K8sStoredSecret,
): boolean {
  return (
    before.hostPattern !== after.hostPattern ||
    (before.pathPattern ?? "") !== (after.pathPattern ?? "")
  );
}

// Build the (secretId → host rule) grant map syncForAgent expects. Shared
// between secret-edit fanout (`update`) and `setAgentAccess`.
function buildHostGrantsMap(
  allSecrets: readonly K8sStoredSecret[],
  grantedIds: readonly string[],
): Map<string, { hosts: readonly { host: string; pathPattern?: string }[] }> {
  const grants = new Map<
    string,
    { hosts: readonly { host: string; pathPattern?: string }[] }
  >();
  for (const s of allSecrets) {
    if (!grantedIds.includes(s.id)) continue;
    grants.set(s.id, {
      hosts: [
        {
          host: s.hostPattern,
          ...(s.pathPattern ? { pathPattern: s.pathPattern } : {}),
        },
      ],
    });
  }
  return grants;
}

/**
 * Sync port for connection-derived egress rules (ADR-035).
 * The secrets module owns the per-agent grant list; this port reconciles
 * `egress_rules` with that list whenever it changes. Optional dep — non-
 * cluster contexts (tests) skip the side effect.
 */
export interface AgentConnectionRulesSync {
  syncForAgent(input: {
    agentId: string;
    decidedBy: string;
    grants: Map<
      string,
      { hosts: readonly { host: string; pathPattern?: string }[] }
    >;
    /** Secret IDs the secrets module owns; rules from app-connections (which
     *  share the `connection:<id>` source prefix) stay untouched. */
    ownedSourceIds: ReadonlySet<string>;
  }): Promise<void>;
}

function toSecretView(s: K8sStoredSecret): SecretView {
  // K8sStoredSecret.type is `string` (label value); narrow to the typed
  // SecretType union via the registry. Anything not a known preset
  // collapses to "generic".
  const type: SecretType = isProviderPresetType(s.type as SecretType)
    ? (s.type as SecretType)
    : "generic";
  const view: SecretView = {
    id: s.id,
    name: s.name,
    type,
    hostPattern: s.hostPattern,
    createdAt: s.createdAt,
  };
  if (s.pathPattern) view.pathPattern = s.pathPattern;
  if (type === "generic" && s.injectionConfig)
    view.injectionConfig = s.injectionConfig;
  if (s.envMappings?.length) view.envMappings = s.envMappings;
  return view;
}

export function createSecretsService(deps: {
  k8sPort: K8sSecretsPort;
  /** Per-agent grant store (annotations on the instance ConfigMap). */
  grants: AgentGrantsPort;
  /** Reconciles egress_rules against the agent's currently-granted secrets
   *  on every setAgentAccess call. */
  connectionRules?: AgentConnectionRulesSync;
  /** Owner sub for the calling user, stamped onto auto-inserted rules
   *  (`decided_by`). Required when `connectionRules` is set. */
  ownerSub?: string;
  /** Resolves agent display names for the `listGrantedAgents` endpoint.
   *  Falls back to agentId as name when unwired. */
  listOwnedAgentSummaries?: () => Promise<
    readonly { id: string; name: string }[]
  >;
}): SecretsService {
  async function createOne(input: SecretCreateInput): Promise<SecretView> {
    const hostPattern = hostPatternFor(input.type, input.hostPattern);
    const id = randomUUID();
    // Anthropic OAuth tokens are `sk-ant-oat…`; API keys are `sk-ant-api…`.
    // Both share the `sk-ant-` prefix, so the discriminator is the segment
    // immediately after.
    const authMode =
      input.type === "anthropic"
        ? input.value.startsWith("sk-ant-oat")
          ? "oauth"
          : "api-key"
        : undefined;
    // Default preset envMappings when the caller didn't supply any.
    // Sources the bundle from the PROVIDERS registry — adding a new
    // preset requires only one entry there, not a branch here.
    const envMappings: EnvMapping[] | undefined = input.envMappings?.length
      ? input.envMappings
      : registryEnvMappings(input.type, authMode);
    // Path pattern: presets that scope to a path (currently only OpenAI's
    // `/v1/*`) take it from the registry; generic secrets respect the
    // user-supplied value.
    const pathPattern = pathPatternFor(input.type) ?? input.pathPattern;
    await deps.k8sPort.createSecret({
      id,
      name: input.name,
      type: input.type,
      value: input.value,
      hostPattern,
      ...(pathPattern ? { pathPattern } : {}),
      ...(input.injectionConfig
        ? { injectionConfig: input.injectionConfig }
        : {}),
      ...(authMode ? { authMode } : {}),
      ...(envMappings?.length ? { envMappings } : {}),
    });
    const createdTwinIds: string[] = [];
    try {
      for (const inj of registryExtraInjections(input.type, authMode)) {
        const twinId = randomUUID();
        await deps.k8sPort.createSecret({
          id: twinId,
          name: twinDisplayName(input.name, inj),
          type: input.type,
          value: input.value,
          hostPattern,
          injectionConfig: inj,
          primarySecretId: id,
        });
        createdTwinIds.push(twinId);
      }
    } catch (err) {
      for (const twinId of createdTwinIds) {
        try {
          await deps.k8sPort.deleteSecret(twinId);
        } catch (cleanupErr) {
          console.warn(
            `secrets-service: orphan twin K8s Secret ${twinId} (primary ${id}, type ${input.type}) — manual cleanup required:`,
            cleanupErr instanceof Error ? cleanupErr.message : cleanupErr,
          );
        }
      }
      try {
        await deps.k8sPort.deleteSecret(id);
      } catch (cleanupErr) {
        console.warn(
          `secrets-service: orphan primary K8s Secret ${id} (type ${input.type}) — manual cleanup required:`,
          cleanupErr instanceof Error ? cleanupErr.message : cleanupErr,
        );
      }
      throw err;
    }
    const view: SecretView = {
      id,
      name: input.name,
      type: input.type,
      hostPattern,
      createdAt: new Date().toISOString(),
    };
    if (pathPattern) view.pathPattern = pathPattern;
    if (input.type === "generic" && input.injectionConfig) {
      view.injectionConfig = input.injectionConfig;
    }
    if (envMappings?.length) view.envMappings = envMappings;
    return view;
  }

  return {
    async list() {
      const secrets = await deps.k8sPort.listSecrets();
      return secrets.filter((s) => !s.primarySecretId).map(toSecretView);
    },

    create: createOne,

    async createGithubPat(
      input: SecretCreateGithubPatInput,
    ): Promise<CreateGithubPatOutput> {
      // Basic auth header value for the github.com half: HTTP Basic decodes
      // the base64-wrapped `username:password` form. Using the literal
      // `x-access-token` username is GitHub's documented pattern for PATs.
      const basicValue = Buffer.from(`x-access-token:${input.token}`).toString(
        "base64",
      );
      const apiSecret = await createOne({
        type: "generic",
        name: input.name,
        value: input.token,
        hostPattern: "api.github.com",
        injectionConfig: {
          headerName: "Authorization",
          valueFormat: "Bearer {value}",
        },
        envMappings: [
          { envName: "GH_TOKEN", placeholder: DEFAULT_ENV_PLACEHOLDER },
        ],
      });
      let gitSecret: SecretView;
      try {
        gitSecret = await createOne({
          type: "generic",
          name: input.name,
          value: basicValue,
          hostPattern: "github.com",
          injectionConfig: {
            headerName: "Authorization",
            valueFormat: "Basic {value}",
          },
        });
      } catch (err) {
        // Roll back the api.github.com half so a partial failure doesn't
        // leave a half-configured PAT behind. Suppress secondary delete
        // errors — the original cause is what the caller needs to see.
        await deps.k8sPort.deleteSecret(apiSecret.id).catch(() => {});
        throw err;
      }
      return {
        name: input.name,
        apiSecretId: apiSecret.id,
        gitSecretId: gitSecret.id,
      };
    },

    async updateGithubPat(
      input: SecretUpdateGithubPatInput,
    ): Promise<UpdateGithubPatOutput> {
      // Re-wrap the github.com half server-side so callers send `{token}`
      // only — same shape symmetry as createGithubPat.
      //
      // Value-only update: envMappings / hostPattern / injectionConfig
      // stay the same, so neither the `secrets-rev` rolling-restart
      // signal nor the connection-rules sync fires. The gateway pod's
      // Envoy picks up the new value via SDS without a pod restart.
      //
      // Partial-failure note: if the github.com update throws, the
      // api.github.com half already holds the new token while the
      // github.com half still holds the prior wrapped value. The raw
      // prior value isn't recoverable from the SDS file (the format
      // template is baked into it), so we don't attempt to restore —
      // surface the original error and let the caller retry. In
      // practice this leaves `gh` working with the new token and
      // `git clone` working with the old; a retry of `updateGithubPat`
      // converges both halves.
      const basicValue = Buffer.from(`x-access-token:${input.token}`).toString(
        "base64",
      );
      const apiResult = await deps.k8sPort.updateSecret(input.apiSecretId, {
        value: input.token,
      });
      if (!apiResult)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "api.github.com secret not found",
        });
      const gitResult = await deps.k8sPort.updateSecret(input.gitSecretId, {
        value: basicValue,
      });
      if (!gitResult)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "github.com secret not found",
        });
      return { apiSecretId: input.apiSecretId, gitSecretId: input.gitSecretId };
    },

    async update({ id, ...patch }: SecretUpdateInput) {
      // Anthropic value swaps re-discriminate the auth mode from the new
      // value's prefix and rewrite envMappings + injectionConfig to match.
      // Without this, replacing an API key (stored as
      // `x-api-key: {value}`, env `ANTHROPIC_API_KEY`) with an OAuth
      // token (needs `Authorization: Bearer {value}`, env
      // `CLAUDE_CODE_OAUTH_TOKEN`) leaves the injection metadata stuck
      // at the old mode — Anthropic receives `x-api-key: sk-ant-oat…`
      // and rejects with "Invalid API key". The same prefix rule lives
      // in `create` above; this just teaches `update` to redo it when
      // the caller didn't supply envMappings explicitly (the web UI's
      // Anthropic Edit form does, the CLI's replace path does not).
      const rotation =
        patch.value !== undefined && patch.envMappings === undefined
          ? await anthropicModeRotationFor(deps.k8sPort, id, patch.value)
          : null;
      const result = await deps.k8sPort.updateSecret(id, {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.value !== undefined ? { value: patch.value } : {}),
        ...(patch.hostPattern !== undefined
          ? { hostPattern: patch.hostPattern }
          : {}),
        ...(patch.pathPattern !== undefined
          ? { pathPattern: patch.pathPattern }
          : {}),
        ...(patch.injectionConfig !== undefined
          ? { injectionConfig: patch.injectionConfig }
          : rotation
            ? { injectionConfig: null }
            : {}),
        ...(patch.envMappings !== undefined
          ? { envMappings: patch.envMappings }
          : rotation
            ? { envMappings: rotation.envMappings }
            : {}),
        ...(rotation ? { authMode: rotation.authMode } : {}),
      });
      // ADR-040 fanout. Host edits → re-sync egress_rules per granted
      // agent (hot, no roll). envMappings edits → bump secrets-rev so the
      // controller re-renders the agent pod with the merged env.
      //
      // `updateSecret` returns null when the K8s Secret was deleted between
      // our read and write — surface that as NOT_FOUND so the user sees the
      // save was lost instead of a silent success and a closed dialog.
      if (!result) throw new TRPCError({ code: "NOT_FOUND" });
      const { before, after } = result;

      const valueChanged = patch.value !== undefined;
      const hostChanged = hostOrPathChanged(before, after);
      const envChanged = envMappingsChanged(before, after);
      if (valueChanged || hostChanged) {
        const allSecretsForTwins = await deps.k8sPort.listSecrets();
        const twins = allSecretsForTwins.filter(
          (s) => s.primarySecretId === id,
        );
        for (const twin of twins) {
          await deps.k8sPort.updateSecret(twin.id, {
            ...(valueChanged ? { value: patch.value } : {}),
            ...(hostChanged ? { hostPattern: after.hostPattern } : {}),
          });
        }
      }

      if (!hostChanged && !envChanged) return;
      if (!deps.connectionRules || !deps.ownerSub) return;

      const granted = await deps.grants.listAgentsGrantedSecret(id);
      if (granted.length === 0) return;

      const allSecrets = await deps.k8sPort.listSecrets();
      const ownedSourceIds = new Set(allSecrets.map((s) => s.id));
      const ownerSub = deps.ownerSub;
      const connectionRules = deps.connectionRules;

      await Promise.all(
        granted.map(async (g) => {
          if (hostChanged) {
            await connectionRules.syncForAgent({
              agentId: g.agentId,
              decidedBy: ownerSub,
              grants: buildHostGrantsMap(allSecrets, g.grantedSecretIds),
              ownedSourceIds,
            });
          }
          if (envChanged) {
            const grantedForAgent = allSecrets.filter((s) =>
              g.grantedSecretIds.includes(s.id),
            );
            const hash = combinedSecretsRev(grantedForAgent);
            // Per ADR-046, the agent is its own resource — one Agent CM per
            // agentId, so we bump the rev annotation on that CM directly.
            await deps.grants.bumpSecretsRev(g.agentId, hash);
          }
        }),
      );
    },

    async delete(id) {
      // Twins first; primary last on success so retry-after-failure is clean.
      const allSecrets = await deps.k8sPort.listSecrets();
      const twinIds = allSecrets
        .filter((s) => s.primarySecretId === id)
        .map((s) => s.id);
      for (const twinId of twinIds) {
        await deps.k8sPort.deleteSecret(twinId);
      }
      await deps.k8sPort.deleteSecret(id);
    },

    async getAgentAccess(agentId: string) {
      const grants = await deps.grants.get(agentId);
      const allSecrets = await deps.k8sPort.listSecrets();
      const twinIds = new Set(
        allSecrets.filter((s) => s.primarySecretId).map((s) => s.id),
      );
      return {
        secretIds: grants.grantedSecretIds.filter((id) => !twinIds.has(id)),
      };
    },

    async listGrantedAgents(secretId: string) {
      const granted = await deps.grants.listAgentsGrantedSecret(secretId);
      if (granted.length === 0) return [];
      const all = await deps.listOwnedAgentSummaries?.();
      const byId = new Map((all ?? []).map((a) => [a.id, a.name] as const));
      return granted.map((g) => ({
        id: g.agentId,
        name: byId.get(g.agentId) ?? g.agentId,
      }));
    },

    async setAgentAccess(agentId: string, access: AgentAccess) {
      const allSecrets = await deps.k8sPort.listSecrets();
      const twinIds = new Set(
        allSecrets.filter((s) => s.primarySecretId).map((s) => s.id),
      );
      const twinsByPrimary = new Map<string, string[]>();
      for (const s of allSecrets) {
        if (!s.primarySecretId) continue;
        const list = twinsByPrimary.get(s.primarySecretId) ?? [];
        list.push(s.id);
        twinsByPrimary.set(s.primarySecretId, list);
      }
      const primaries = access.secretIds.filter((id) => !twinIds.has(id));
      const expanded = [
        ...primaries,
        ...primaries.flatMap((id) => twinsByPrimary.get(id) ?? []),
      ];
      await deps.grants.setSecretGrants(agentId, expanded);

      if (deps.connectionRules && deps.ownerSub) {
        const ownedSourceIds = new Set(allSecrets.map((s) => s.id));
        await deps.connectionRules.syncForAgent({
          agentId,
          decidedBy: deps.ownerSub,
          grants: buildHostGrantsMap(allSecrets, expanded),
          ownedSourceIds,
        });
      }
    },
  };
}
