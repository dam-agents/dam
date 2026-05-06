import { randomUUID } from "node:crypto";
import {
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
      await deps.k8sPort.createSecret({
        id,
        name: input.name,
        type: input.type,
        value: input.value,
        hostPattern,
        ...(input.pathPattern ? { pathPattern: input.pathPattern } : {}),
        ...(input.injectionConfig ? { injectionConfig: input.injectionConfig } : {}),
        ...(authMode ? { authMode } : {}),
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
      return view;
    },

    async update({ id, ...patch }: UpdateSecretInput) {
      await deps.k8sPort.updateSecret(id, {
        ...(patch.value !== undefined ? { value: patch.value } : {}),
        ...(patch.hostPattern !== undefined ? { hostPattern: patch.hostPattern } : {}),
        ...(patch.pathPattern !== undefined ? { pathPattern: patch.pathPattern } : {}),
        ...(patch.injectionConfig !== undefined ? { injectionConfig: patch.injectionConfig } : {}),
      });
    },

    async delete(id) {
      await deps.k8sPort.deleteSecret(id);
    },

    async getAgentAccess(agentId: string) {
      const grants = await deps.grants.get(agentId);
      return { secretIds: grants.grantedSecretIds };
    },

    async setAgentAccess(agentId: string, access: AgentAccess) {
      await deps.grants.setSecretGrants(agentId, access.secretIds);

      // Sync `connection:<id>` egress rules against the new grant list so
      // toggling an Anthropic / generic Secret produces matching rule
      // changes. Always-selective: empty list = no rules, no special "all"
      // shortcut.
      if (deps.connectionRules && deps.ownerSub) {
        // List once — used for both grant assembly and computing
        // ownedSourceIds (every secret id this user owns).
        const allSecrets = await deps.k8sPort.listSecrets();
        const grants = new Map<string, { hosts: readonly { host: string; pathPattern?: string }[] }>();
        if (access.secretIds.length > 0) {
          for (const s of allSecrets) {
            if (!access.secretIds.includes(s.id)) continue;
            grants.set(s.id, {
              hosts: [{ host: s.hostPattern, ...(s.pathPattern ? { pathPattern: s.pathPattern } : {}) }],
            });
          }
        }
        // ownedSourceIds = every owner secret id, granted or not. Lets the
        // sync revoke stale secret-derived rules without touching
        // app-connection rows that share the `connection:<id>` prefix.
        const ownedSourceIds = new Set(allSecrets.map((s) => s.id));
        await deps.connectionRules.syncForAgent({
          agentId,
          decidedBy: deps.ownerSub,
          grants,
          ownedSourceIds,
        });
      }
    },
  };
}
