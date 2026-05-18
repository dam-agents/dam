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

interface UpdateCall {
  id: string;
  value?: string;
}

function makePort(opts: { missingIds?: string[] } = {}) {
  const store = new Map<string, K8sStoredSecret>();
  // Seed both halves of an existing PAT pair so updateSecret has something
  // to read for before/after diffs.
  store.set("api-1", {
    id: "api-1",
    name: "GitHub",
    type: "generic",
    hostPattern: "api.github.com",
    createdAt: new Date().toISOString(),
  });
  store.set("git-1", {
    id: "git-1",
    name: "GitHub",
    type: "generic",
    hostPattern: "github.com",
    createdAt: new Date().toISOString(),
  });
  const updates: UpdateCall[] = [];
  const port: K8sSecretsPort = {
    async listSecrets() {
      return Array.from(store.values());
    },
    async createSecret() {},
    async updateSecret(id, patch) {
      if (opts.missingIds?.includes(id)) return null;
      const before = store.get(id);
      if (!before) return null;
      updates.push({ id, value: patch.value });
      return { before, after: before };
    },
    async deleteSecret(id) {
      store.delete(id);
    },
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

describe("secrets-service.updateGithubPat", () => {
  it("updates both halves with token + base64-wrapped basic auth", async () => {
    const { port, updates } = makePort();
    const { port: grants } = makeGrants();
    const svc = createSecretsService({
      k8sPort: port,
      grants,
      ownerSub: "owner-1",
    });

    const result = await svc.updateGithubPat({
      apiSecretId: "api-1",
      gitSecretId: "git-1",
      token: "ghp_newtoken",
    });

    expect(result).toEqual({ apiSecretId: "api-1", gitSecretId: "git-1" });
    expect(updates).toHaveLength(2);
    expect(updates[0]).toEqual({ id: "api-1", value: "ghp_newtoken" });
    expect(updates[1]).toEqual({
      id: "git-1",
      value: Buffer.from("x-access-token:ghp_newtoken").toString("base64"),
    });
  });

  it("throws NOT_FOUND when the api half doesn't exist", async () => {
    const { port } = makePort({ missingIds: ["api-1"] });
    const { port: grants } = makeGrants();
    const svc = createSecretsService({
      k8sPort: port,
      grants,
      ownerSub: "owner-1",
    });

    await expect(
      svc.updateGithubPat({
        apiSecretId: "api-1",
        gitSecretId: "git-1",
        token: "ghp_x",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
