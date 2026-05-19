import { describe, it, expect } from "vitest";

import { createSecretsService } from "../../modules/secrets/services/secrets-service.js";
import type {
  K8sSecretsPort,
  K8sStoredSecret,
} from "../../modules/secrets/infrastructure/k8s-secrets-port.js";
import type {
  AgentGrants,
  AgentGrantsPort,
} from "../../modules/agents/infrastructure/agent-grants-port.js";

type CreateCall = Parameters<K8sSecretsPort["createSecret"]>[0];

function makePort(opts: { failSecondCreate?: boolean } = {}) {
  const store = new Map<string, K8sStoredSecret>();
  const created: CreateCall[] = [];
  const deleted: string[] = [];
  const port: K8sSecretsPort = {
    async listSecrets() {
      return Array.from(store.values());
    },
    async createSecret(input) {
      if (opts.failSecondCreate && created.length === 1) {
        throw new Error("boom on second create");
      }
      created.push(input);
      store.set(input.id, {
        id: input.id,
        name: input.name,
        type: input.type,
        hostPattern: input.hostPattern,
        ...(input.pathPattern ? { pathPattern: input.pathPattern } : {}),
        ...(input.envMappings ? { envMappings: input.envMappings } : {}),
        ...(input.injectionConfig
          ? { injectionConfig: input.injectionConfig }
          : {}),
        ...(input.authMode ? { authMode: input.authMode } : {}),
        createdAt: new Date().toISOString(),
      });
    },
    async updateSecret() {
      return null;
    },
    async deleteSecret(id) {
      deleted.push(id);
      store.delete(id);
    },
  };
  return { port, store, created, deleted };
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

describe("secrets-service.createGithubPat", () => {
  it("creates two generic secrets with matching name and returns both ids", async () => {
    const { port, created, store } = makePort();
    const { port: grants } = makeGrants();
    const svc = createSecretsService({
      k8sPort: port,
      grants,
      ownerSub: "owner-1",
    });

    const result = await svc.createGithubPat({
      name: "guido",
      token: "ghp_test123",
    });

    expect(result.name).toBe("guido");
    expect(result.apiSecretId).toBeTruthy();
    expect(result.gitSecretId).toBeTruthy();
    expect(result.apiSecretId).not.toBe(result.gitSecretId);
    expect(store.size).toBe(2);

    expect(created).toHaveLength(2);
    const apiCall = created[0]!;
    const gitCall = created[1]!;

    expect(apiCall).toMatchObject({
      type: "generic",
      name: "guido",
      value: "ghp_test123",
      hostPattern: "api.github.com",
      injectionConfig: {
        headerName: "Authorization",
        valueFormat: "Bearer {value}",
      },
      envMappings: [{ envName: "GH_TOKEN", placeholder: "dummy-placeholder" }],
    });

    const expectedBasic = Buffer.from("x-access-token:ghp_test123").toString(
      "base64",
    );
    expect(gitCall).toMatchObject({
      type: "generic",
      name: "guido",
      value: expectedBasic,
      hostPattern: "github.com",
      injectionConfig: {
        headerName: "Authorization",
        valueFormat: "Basic {value}",
      },
    });
    expect(gitCall.envMappings).toBeUndefined();

    expect(apiCall.id).toBe(result.apiSecretId);
    expect(gitCall.id).toBe(result.gitSecretId);
  });

  it("rolls back the first secret if the second create fails", async () => {
    const { port, created, deleted, store } = makePort({
      failSecondCreate: true,
    });
    const { port: grants } = makeGrants();
    const svc = createSecretsService({
      k8sPort: port,
      grants,
      ownerSub: "owner-1",
    });

    await expect(
      svc.createGithubPat({ name: "guido", token: "ghp_test123" }),
    ).rejects.toThrow("boom on second create");

    expect(created).toHaveLength(1);
    expect(deleted).toEqual([created[0]!.id]);
    expect(store.size).toBe(0);
  });
});
