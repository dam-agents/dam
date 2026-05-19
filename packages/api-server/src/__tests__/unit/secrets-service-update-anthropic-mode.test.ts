import { describe, it, expect } from "vitest";
import { PROVIDERS, type EnvMapping } from "api-server-api";

import { createSecretsService } from "../../modules/secrets/services/secrets-service.js";
import type {
  AuthMode,
  K8sSecretsPort,
  K8sStoredSecret,
} from "../../modules/secrets/infrastructure/k8s-secrets-port.js";
import type {
  AgentGrants,
  AgentGrantsPort,
} from "../../modules/agents/infrastructure/agent-grants-port.js";

interface UpdateCall {
  id: string;
  authMode?: AuthMode;
  envMappings?: EnvMapping[];
  injectionConfig?: unknown;
  value?: string;
}

const ANTHROPIC_OAUTH_MAPPING = PROVIDERS.anthropic.modes.find(
  (m) => m.key === "oauth",
)!.defaultEnvMappings;

function makePort(existing: K8sStoredSecret) {
  const store = new Map([[existing.id, existing]]);
  const updates: UpdateCall[] = [];
  const port: K8sSecretsPort = {
    async listSecrets() {
      return Array.from(store.values());
    },
    async createSecret() {},
    async updateSecret(id, patch) {
      const before = store.get(id);
      if (!before) return null;
      updates.push({ id, ...patch });
      const after: K8sStoredSecret = {
        ...before,
        ...(patch.authMode !== undefined ? { authMode: patch.authMode } : {}),
        ...(patch.envMappings !== undefined
          ? { envMappings: patch.envMappings }
          : {}),
      };
      store.set(id, after);
      return { before, after };
    },
    async deleteSecret() {},
  };
  return { port, updates };
}

function makeGrants() {
  const port: AgentGrantsPort = {
    async get(): Promise<AgentGrants> {
      return { grantedSecretIds: [], grantedConnectionIds: [] };
    },
    async setSecretGrants() {},
    async setConnectionGrants() {},
    async listAgentsGrantedSecret() {
      return [];
    },
    async bumpSecretsRev() {},
  };
  return { port };
}

function anthropicSecret(authMode: AuthMode): K8sStoredSecret {
  return {
    id: "secret-1",
    name: "Anthropic",
    type: "anthropic",
    hostPattern: "api.anthropic.com",
    createdAt: new Date().toISOString(),
    authMode,
  };
}

describe("secrets-service.update — Anthropic auth-mode rotation", () => {
  it("api-key → oauth: rewrites env, clears injection config, flips auth-mode", async () => {
    const { port, updates } = makePort(anthropicSecret("api-key"));
    const { port: grants } = makeGrants();
    const svc = createSecretsService({
      k8sPort: port,
      grants,
      ownerSub: "owner-1",
    });

    await svc.update({ id: "secret-1", value: "sk-ant-oat01-newtoken" });

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      id: "secret-1",
      value: "sk-ant-oat01-newtoken",
      authMode: "oauth",
      envMappings: ANTHROPIC_OAUTH_MAPPING,
      injectionConfig: null,
    });
  });

  it("no-op when the new value's prefix matches the existing mode", async () => {
    const { port, updates } = makePort(anthropicSecret("api-key"));
    const { port: grants } = makeGrants();
    const svc = createSecretsService({
      k8sPort: port,
      grants,
      ownerSub: "owner-1",
    });

    await svc.update({ id: "secret-1", value: "sk-ant-api03-anothernewkey" });

    expect(updates).toHaveLength(1);
    expect(updates[0]?.authMode).toBeUndefined();
    expect(updates[0]?.envMappings).toBeUndefined();
    expect(updates[0]?.injectionConfig).toBeUndefined();
  });

  it("does not touch non-Anthropic secrets", async () => {
    const ibm: K8sStoredSecret = {
      id: "secret-2",
      name: "IBM LiteLLM",
      type: "ibm-litellm",
      hostPattern: "ete-litellm.example",
      createdAt: new Date().toISOString(),
    };
    const { port, updates } = makePort(ibm);
    const { port: grants } = makeGrants();
    const svc = createSecretsService({
      k8sPort: port,
      grants,
      ownerSub: "owner-1",
    });

    await svc.update({ id: "secret-2", value: "sk-litellm-new" });

    expect(updates[0]?.authMode).toBeUndefined();
    expect(updates[0]?.envMappings).toBeUndefined();
    expect(updates[0]?.injectionConfig).toBeUndefined();
  });

  it("caller-supplied envMappings wins over the rotation", async () => {
    const { port, updates } = makePort(anthropicSecret("api-key"));
    const { port: grants } = makeGrants();
    const svc = createSecretsService({
      k8sPort: port,
      grants,
      ownerSub: "owner-1",
    });

    const explicit: EnvMapping[] = [
      { envName: "CUSTOM_VAR", placeholder: "x" },
    ];
    await svc.update({
      id: "secret-1",
      value: "sk-ant-oat01-newtoken",
      envMappings: explicit,
    });

    // The early-return guard inside the service skips the rotation
    // helper when the caller supplied envMappings — explicit beats
    // implicit. The K8sPort therefore receives the caller's mappings
    // unchanged and no authMode flip.
    expect(updates[0]?.envMappings).toEqual(explicit);
    expect(updates[0]?.authMode).toBeUndefined();
  });
});
