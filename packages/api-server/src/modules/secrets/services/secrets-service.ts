import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { RuntimeMutator } from "../../runtime-delivery/index.js";
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
import { securityLog } from "../../../core/security-log.js";

interface InternalSecretCreate {
  type: SecretType;
  name: string;
  value: string;
  hostPattern?: string;
  pathPattern?: string;
  injectionConfig?: InjectionConfig;
  envMappings?: EnvMapping[];
}

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

function envMappingsChanged(
  before: K8sStoredSecret,
  after: K8sStoredSecret,
): boolean {
  return (
    JSON.stringify(before.envMappings ?? []) !==
    JSON.stringify(after.envMappings ?? [])
  );
}

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
  /** Delivers env changes to granted agents over the runtime channel. */
  runtimeMutator?: RuntimeMutator;
}): SecretsService {
  async function deliverToAgent(agentId: string): Promise<void> {
    if (!deps.runtimeMutator) return;
    await deps.runtimeMutator.bump(agentId, []);
    await deps.runtimeMutator.enqueueAfterCommit(agentId);
  }

  // Pull in twins so a GitHub PAT's two halves are always granted together.
  function expandWith(
    secretIds: string[],
    allSecrets: readonly K8sStoredSecret[],
  ): string[] {
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
    const primaries = secretIds.filter((id) => !twinIds.has(id));
    return [
      ...primaries,
      ...primaries.flatMap((id) => twinsByPrimary.get(id) ?? []),
    ];
  }

  async function createOne(input: InternalSecretCreate): Promise<SecretView> {
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
          securityLog("error", "secret.orphan_cleanup_failed", {
            category: "credential",
            actor: deps.ownerSub ?? null,
            actorKind: "user",
            target: twinId,
            result: "failure",
            reason:
              cleanupErr instanceof Error ? cleanupErr.message : "unknown",
            detail: { primarySecretId: id, type: input.type, role: "twin" },
          });
        }
      }
      try {
        await deps.k8sPort.deleteSecret(id);
      } catch (cleanupErr) {
        securityLog("error", "secret.orphan_cleanup_failed", {
          category: "credential",
          actor: deps.ownerSub ?? null,
          actorKind: "user",
          target: id,
          result: "failure",
          reason: cleanupErr instanceof Error ? cleanupErr.message : "unknown",
          detail: { type: input.type, role: "primary" },
        });
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
    // A credential stored at rest — record who, what kind, and where it
    // injects. NEVER the value.
    securityLog("info", "secret.create", {
      category: "credential",
      actor: deps.ownerSub ?? null,
      actorKind: "user",
      target: id,
      result: "success",
      detail: {
        type: input.type,
        hostPattern,
        twins: createdTwinIds.length,
      },
    });
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
      const rotation =
        patch.value !== undefined && patch.envMappings === undefined
          ? await anthropicModeRotationFor(deps.k8sPort, id, patch.value)
          : null;
      const result = await deps.k8sPort.updateSecret(id, {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.value !== undefined ? { value: patch.value } : {}),
        ...(rotation ? { injectionConfig: null } : {}),
        ...(patch.envMappings !== undefined
          ? { envMappings: patch.envMappings }
          : rotation
            ? { envMappings: rotation.envMappings }
            : {}),
        ...(rotation ? { authMode: rotation.authMode } : {}),
      });
      if (!result) {
        securityLog("warn", "secret.update_notfound", {
          category: "credential",
          actor: deps.ownerSub ?? null,
          actorKind: "user",
          target: id,
          result: "failure",
          reason: "not-found",
        });
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const { before, after } = result;

      const valueChanged = patch.value !== undefined;
      // Rotation/timestamp forensics most wants after a suspected leak — log
      // metadata only (what changed), never the value.
      securityLog("info", "secret.update", {
        category: "credential",
        actor: deps.ownerSub ?? null,
        actorKind: "user",
        target: id,
        result: "success",
        detail: {
          valueChanged,
          nameChanged: patch.name !== undefined,
          authModeRotated: rotation !== null,
        },
      });
      const envChanged = envMappingsChanged(before, after);
      if (valueChanged) {
        const allSecretsForTwins = await deps.k8sPort.listSecrets();
        const twins = allSecretsForTwins.filter(
          (s) => s.primarySecretId === id,
        );
        for (const twin of twins) {
          await deps.k8sPort.updateSecret(twin.id, { value: patch.value });
        }
      }

      if (!envChanged) return;

      const granted = await deps.grants.listAgentsGrantedSecret(id);
      if (granted.length === 0) return;

      // Re-deliver to each granted agent; the state-builder reads the new env-mappings live.
      await Promise.all(granted.map((g) => deliverToAgent(g.agentId)));
    },

    async delete(id) {
      // Capture grant holders before deletion so we can re-deliver after.
      const granted = await deps.grants.listAgentsGrantedSecret(id);
      // Twins first; primary last on success so retry-after-failure is clean.
      const allSecrets = await deps.k8sPort.listSecrets();
      const twinIds = allSecrets
        .filter((s) => s.primarySecretId === id)
        .map((s) => s.id);
      for (const twinId of twinIds) {
        await deps.k8sPort.deleteSecret(twinId);
      }
      await deps.k8sPort.deleteSecret(id);
      // Proves when a credential was revoked/destroyed.
      securityLog("info", "secret.delete", {
        category: "credential",
        actor: deps.ownerSub ?? null,
        actorKind: "user",
        target: id,
        result: "success",
        detail: { twins: twinIds.length },
      });
      // Re-deliver so the deleted secret's placeholder drops from each granted
      // agent's env on the next snapshot (the env-source omits missing secrets).
      await Promise.all(granted.map((g) => deliverToAgent(g.agentId)));
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

    async expandSecretGrants(secretIds: string[]) {
      return expandWith(secretIds, await deps.k8sPort.listSecrets());
    },

    async setAgentAccess(agentId: string, access: AgentAccess) {
      const allSecrets = await deps.k8sPort.listSecrets();
      const expanded = expandWith(access.secretIds, allSecrets);
      const primaries = access.secretIds.filter(
        (id) => !allSecrets.find((s) => s.id === id)?.primarySecretId,
      );
      await deps.grants.setSecretGrants(agentId, expanded);
      // Central to "which agent could use credential X at time T".
      securityLog("info", "secret.grants_set", {
        category: "authz-list",
        actor: deps.ownerSub ?? null,
        actorKind: "user",
        agentId,
        result: "success",
        detail: { primarySecretIds: primaries, expandedCount: expanded.length },
      });

      if (deps.connectionRules && deps.ownerSub) {
        const ownedSourceIds = new Set(allSecrets.map((s) => s.id));
        await deps.connectionRules.syncForAgent({
          agentId,
          decidedBy: deps.ownerSub,
          grants: buildHostGrantsMap(allSecrets, expanded),
          ownedSourceIds,
        });
      }

      // Deliver the new grant set over the runtime channel.
      await deliverToAgent(agentId);
    },
  };
}
