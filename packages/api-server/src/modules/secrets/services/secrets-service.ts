import { createHash, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  ANTHROPIC_API_KEY_ENV_MAPPING,
  ANTHROPIC_OAUTH_ENV_MAPPING,
  type EnvMapping,
  type SecretsService,
  type CreateSecretInput,
  type UpdateSecretInput,
  type SecretType,
  type SecretView,
  type AgentAccess,
} from "api-server-api";
import type {
  K8sSecretsPort,
  K8sStoredSecret,
} from "./../infrastructure/k8s-secrets-port.js";
import type { AgentGrantsPort } from "../../agents/infrastructure/agent-grants-port.js";
import { hostPatternFor } from "../domain/types.js";

// Anthropic envMappings the api-server defaults onto created secrets when
// the caller didn't supply any — keeps non-UI clients (CLI, scripts) from
// producing secrets the controller can't merge into agent pod env. ADR-040.
function defaultAnthropicEnvMappings(authMode: "api-key" | "oauth"): EnvMapping[] {
  return authMode === "api-key"
    ? [ANTHROPIC_API_KEY_ENV_MAPPING]
    : [ANTHROPIC_OAUTH_ENV_MAPPING];
}

// `secrets-rev` hashes only what affects the agent pod's env. hostPattern,
// pathPattern, and injectionConfig are gateway-side and have their own roll
// trigger (envoy-secrets-rev on the gateway StatefulSet); rolling the agent
// pod for them would be gratuitous. ADR-040 §Fanout: host edits hot, env
// edits roll.
function combinedSecretsRev(grantedSecrets: readonly K8sStoredSecret[]): string {
  const data = [...grantedSecrets]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((s) => ({ id: s.id, envMappings: s.envMappings ?? [] }));
  return createHash("sha256").update(JSON.stringify(data)).digest("hex").slice(0, 16);
}

function envMappingsChanged(before: K8sStoredSecret, after: K8sStoredSecret): boolean {
  return JSON.stringify(before.envMappings ?? []) !== JSON.stringify(after.envMappings ?? []);
}

function hostOrPathChanged(before: K8sStoredSecret, after: K8sStoredSecret): boolean {
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
  const grants = new Map<string, { hosts: readonly { host: string; pathPattern?: string }[] }>();
  for (const s of allSecrets) {
    if (!grantedIds.includes(s.id)) continue;
    grants.set(s.id, {
      hosts: [{ host: s.hostPattern, ...(s.pathPattern ? { pathPattern: s.pathPattern } : {}) }],
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
    grants: Map<string, { hosts: readonly { host: string; pathPattern?: string }[] }>;
    /** Secret IDs the secrets module owns; rules from app-connections (which
     *  share the `connection:<id>` source prefix) stay untouched. */
    ownedSourceIds: ReadonlySet<string>;
  }): Promise<void>;
}

function toSecretView(s: K8sStoredSecret): SecretView {
  const type: SecretType = s.type === "anthropic" ? "anthropic" : "generic";
  const view: SecretView = {
    id: s.id,
    name: s.name,
    type,
    hostPattern: s.hostPattern,
    createdAt: s.createdAt,
  };
  if (s.pathPattern) view.pathPattern = s.pathPattern;
  if (type === "generic" && s.injectionConfig) view.injectionConfig = s.injectionConfig;
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
  listOwnedAgentSummaries?: () => Promise<readonly { id: string; name: string }[]>;
}): SecretsService {
  return {
    async list() {
      const secrets = await deps.k8sPort.listSecrets();
      return secrets.map(toSecretView);
    },

    async create(input: CreateSecretInput) {
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
      // Default Anthropic envMappings when the caller didn't supply any —
      // makes the controller's source-of-truth read robust to non-UI callers
      // (ADR-040). Generic secrets are not defaulted: the user declares what
      // env they need.
      const envMappings: EnvMapping[] | undefined =
        input.envMappings?.length
          ? input.envMappings
          : input.type === "anthropic" && authMode
            ? defaultAnthropicEnvMappings(authMode)
            : undefined;
      await deps.k8sPort.createSecret({
        id,
        name: input.name,
        type: input.type,
        value: input.value,
        hostPattern,
        ...(input.pathPattern ? { pathPattern: input.pathPattern } : {}),
        ...(input.injectionConfig ? { injectionConfig: input.injectionConfig } : {}),
        ...(authMode ? { authMode } : {}),
        ...(envMappings?.length ? { envMappings } : {}),
      });
      const view: SecretView = {
        id,
        name: input.name,
        type: input.type,
        hostPattern,
        createdAt: new Date().toISOString(),
      };
      if (input.pathPattern) view.pathPattern = input.pathPattern;
      if (input.type === "generic" && input.injectionConfig) {
        view.injectionConfig = input.injectionConfig;
      }
      if (envMappings?.length) view.envMappings = envMappings;
      return view;
    },

    async update({ id, ...patch }: UpdateSecretInput) {
      const result = await deps.k8sPort.updateSecret(id, {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.value !== undefined ? { value: patch.value } : {}),
        ...(patch.hostPattern !== undefined ? { hostPattern: patch.hostPattern } : {}),
        ...(patch.pathPattern !== undefined ? { pathPattern: patch.pathPattern } : {}),
        ...(patch.injectionConfig !== undefined ? { injectionConfig: patch.injectionConfig } : {}),
        ...(patch.envMappings !== undefined ? { envMappings: patch.envMappings } : {}),
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
      const hostChanged = hostOrPathChanged(before, after);
      const envChanged = envMappingsChanged(before, after);
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
            const grantedForAgent = allSecrets.filter((s) => g.grantedSecretIds.includes(s.id));
            const hash = combinedSecretsRev(grantedForAgent);
            await Promise.all(
              g.instanceCmNames.map((cmName) => deps.grants.bumpSecretsRev(cmName, hash)),
            );
          }
        }),
      );
    },

    async delete(id) {
      await deps.k8sPort.deleteSecret(id);
    },

    async getAgentAccess(agentId: string) {
      const grants = await deps.grants.get(agentId);
      return { secretIds: grants.grantedSecretIds };
    },

    async listGrantedAgents(secretId: string) {
      const granted = await deps.grants.listAgentsGrantedSecret(secretId);
      if (granted.length === 0) return [];
      const all = await deps.listOwnedAgentSummaries?.();
      const byId = new Map((all ?? []).map((a) => [a.id, a.name] as const));
      return granted.map((g) => ({ id: g.agentId, name: byId.get(g.agentId) ?? g.agentId }));
    },

    async setAgentAccess(agentId: string, access: AgentAccess) {
      await deps.grants.setSecretGrants(agentId, access.secretIds);

      // Sync `connection:<id>` egress rules against the new grant list.
      // Always-selective: empty list = no rules.
      if (deps.connectionRules && deps.ownerSub) {
        const allSecrets = await deps.k8sPort.listSecrets();
        // ownedSourceIds = every owner secret id, granted or not — scopes
        // the sync's revoke pass to this module's rows so app-connection
        // rules (sharing the `connection:<id>` prefix) stay untouched.
        const ownedSourceIds = new Set(allSecrets.map((s) => s.id));
        await deps.connectionRules.syncForAgent({
          agentId,
          decidedBy: deps.ownerSub,
          grants: buildHostGrantsMap(allSecrets, access.secretIds),
          ownedSourceIds,
        });
      }
    },
  };
}
