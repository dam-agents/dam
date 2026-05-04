import {
  ANTHROPIC_API_KEY_ENV_MAPPING,
  ANTHROPIC_OAUTH_ENV_MAPPING,
  type SecretsService,
  type CreateSecretInput,
  type UpdateSecretInput,
  type SecretType,
  type SecretView,
  type AgentAccess,
} from "api-server-api";
import type {
  OnecliSecret,
  OnecliSecretsPort,
} from "./../infrastructure/onecli-secrets-port.js";
import type { K8sSecretsPort } from "./../infrastructure/k8s-secrets-port.js";
import { hostPatternFor } from "../domain/types.js";

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
    grants: Map<string, { hosts: readonly string[] }>;
  }): Promise<void>;
}

/** Once per process: Anthropic secret IDs we've already attempted to backfill. Prevents N writes per list() call. */
const backfilled = new Set<string>();

function toSecretView(s: OnecliSecret): SecretView {
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
  if (type === "anthropic" && s.metadata?.authMode) view.authMode = s.metadata.authMode;
  if (s.metadata?.envMappings) view.envMappings = s.metadata.envMappings;
  return view;
}

/**
 * Best-effort K8s mirror; OneCLI remains the source of truth. If the K8s write
 * fails, we log and proceed — the OneCLI path (today's behavior) is unchanged.
 *
 * The error is logged with a stable token (`k8s-mirror-failed`) and structured
 * fields (op, secretId, error) so log scrapers can detect the failure mode
 * without depending on free-form text. On the experimental Envoy path a failed
 * mirror means the sidecar will not see this credential — important enough to
 * surface in dashboards/alerts.
 */
async function mirrorToK8s(
  meta: { op: "create" | "update" | "delete"; secretId: string },
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      "[secrets-service] k8s-mirror-failed",
      JSON.stringify({ ...meta, error: message }),
    );
  }
}

export function createSecretsService(deps: {
  port: OnecliSecretsPort;
  k8sPort?: K8sSecretsPort;
  /** Reconciles egress_rules against the agent's currently-granted secrets
   *  on every setAgentAccess call. */
  connectionRules?: AgentConnectionRulesSync;
  /** Owner sub for the calling user, stamped onto auto-inserted rules
   *  (`decided_by`). Required when `connectionRules` is set. */
  ownerSub?: string;
}): SecretsService {
  return {
    async list() {
      const secrets = await deps.port.listSecrets();

      // One-shot migration for Anthropic secrets predating explicit env picking:
      // backfill envMappings based on OneCLI's detected authMode so legacy
      // secrets keep working without a migration job.
      for (const s of secrets) {
        if (
          s.type !== "anthropic" ||
          s.metadata?.envMappings ||
          backfilled.has(s.id)
        ) {
          continue;
        }
        backfilled.add(s.id);
        const mapping =
          s.metadata?.authMode === "api-key"
            ? ANTHROPIC_API_KEY_ENV_MAPPING
            : ANTHROPIC_OAUTH_ENV_MAPPING;
        try {
          await deps.port.updateSecret(s.id, { envMappings: [mapping] });
          s.metadata = {
            ...(s.metadata ?? {}),
            envMappings: [mapping],
          };
        } catch {
          backfilled.delete(s.id);
        }
      }

      return secrets.map(toSecretView);
    },

    async create(input: CreateSecretInput) {
      // Spread keeps new optional fields (pathPattern, injectionConfig) flowing through
      // without enumerating them here; the anthropic default envMapping is filled in
      // lazily by the list() backfill above.
      const hostPattern = hostPatternFor(input.type, input.hostPattern);
      const created = await deps.port.createSecret({
        ...input,
        hostPattern,
      });
      // OneCLI may not echo metadata on create; fall back to the request's envMappings.
      if (!created.metadata?.envMappings && input.envMappings) {
        created.metadata = {
          ...(created.metadata ?? {}),
          envMappings: input.envMappings,
        };
      }
      if (deps.k8sPort) {
        await mirrorToK8s({ op: "create", secretId: created.id }, () => deps.k8sPort!.createSecret({
          id: created.id,
          name: input.name,
          type: input.type,
          value: input.value,
          hostPattern,
          pathPattern: input.pathPattern,
          injectionConfig: input.injectionConfig,
          // Anthropic auth-mode is detected by OneCLI from the value shape and
          // returned in `metadata.authMode`. The K8s mirror needs this to pick
          // `x-api-key` (api-key) vs `Authorization: Bearer ...` (oauth).
          authMode: created.metadata?.authMode,
        }));
      }
      return toSecretView(created);
    },

    async update({ id, ...patch }: UpdateSecretInput) {
      await deps.port.updateSecret(id, patch);
      if (deps.k8sPort) {
        await mirrorToK8s({ op: "update", secretId: id }, () => deps.k8sPort!.updateSecret(id, {
          value: patch.value,
          hostPattern: patch.hostPattern,
          pathPattern: patch.pathPattern,
          injectionConfig: patch.injectionConfig,
        }));
      }
    },

    async delete(id) {
      await deps.port.deleteSecret(id);
      if (deps.k8sPort) {
        await mirrorToK8s({ op: "delete", secretId: id }, () => deps.k8sPort!.deleteSecret(id));
      }
    },

    async getAgentAccess(agentId: string) {
      const agent = await deps.port.findAgentByIdentifier(agentId);
      if (!agent) throw new Error(`Agent "${agentId}" not found in OneCLI`);
      const secretIds = await deps.port.getAgentSecrets(agent.id);
      return { mode: agent.secretMode, secretIds };
    },

    async setAgentAccess(agentId: string, access: AgentAccess) {
      const agent = await deps.port.findAgentByIdentifier(agentId);
      if (!agent) throw new Error(`Agent "${agentId}" not found in OneCLI`);
      if (agent.secretMode !== access.mode) {
        await deps.port.setAgentSecretMode(agent.id, access.mode);
      }
      // Always update the list — the selective list is stored even in "all" mode
      // so the user's selection is preserved across toggles.
      await deps.port.setAgentSecrets(agent.id, access.secretIds);

      // ADR-035 §"Single rules table": auto-mirror the grant list into
      // egress_rules with source=connection:<id>. In "all" mode there's no
      // per-secret grant set — connection rules don't make sense, so we
      // sync an empty map and the sync sweeps any leftover `connection:*`
      // rows from a previous selective configuration. The user can still
      // shape egress via presets or manual rules. Flipping back to
      // selective re-inserts rules from the (preserved) secret list.
      if (deps.connectionRules && deps.ownerSub) {
        const grants = new Map<string, { hosts: readonly string[] }>();
        if (access.mode === "selective") {
          const allSecrets = await deps.port.listSecrets();
          const granted = allSecrets.filter((s) => access.secretIds.includes(s.id));
          for (const s of granted) grants.set(s.id, { hosts: [s.hostPattern] });
        }
        await deps.connectionRules.syncForAgent({
          agentId,
          decidedBy: deps.ownerSub,
          grants,
        });
      }
    },
  };
}
