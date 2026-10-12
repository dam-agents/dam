import { describe, expect, it } from "vitest";
import type { Connection } from "api-server-api";

import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import { createConnectionTemplateRegistry } from "../../modules/connections/domain/connection-template.js";
import type { ProviderKeyProbeOutcome } from "../../modules/connections/domain/provider-key-probe.js";
import type { ConnectionsRepository } from "../../modules/connections/infrastructure/connections-repository.js";
import { createConnectionsService } from "../../modules/connections/services/connections-service.js";
import type { SecretStore } from "../../modules/secret-store/index.js";
import { configureLogger } from "../../core/logger.js";

/**
 * TEST_OVERVIEW: a provider key is checked against the provider before it is
 * stored, on create and on rotation alike. A key the provider refuses is not
 * saved, and the IBM LiteLLM refusal names the one ETE instance whose keys
 * work; a provider that cannot be reached does not block the save.
 */

configureLogger({ level: "error", write: () => {} });

function unused<T extends object>(fields: Partial<T> = {}): T {
  return new Proxy(fields, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected dependency: ${String(key)}`);
    },
  }) as T;
}

function makeService(outcome: ProviderKeyProbeOutcome) {
  const rows = new Map<string, Connection>();
  const secrets = new Map<string, Record<string, string>>();
  const probed: string[] = [];
  const svc = createConnectionsService({
    isOwnedAgent: async () => true,
    ownerId: "owner",
    templates: createConnectionTemplateRegistry(buildCatalog()),
    repo: unused<ConnectionsRepository>({
      insert: async (c) => void rows.set(c.id, c),
      get: async (id) => rows.get(id) ?? null,
      mergeInputs: async () => {},
    }),
    secretStore: unused<SecretStore>({
      storeId: "test",
      mintRef: (meta) => ({ storeId: "test", path: meta.purpose, field: "" }),
      put: async (ref, fields) => void secrets.set(ref.path, fields),
      putFields: async (ref, fields) => void secrets.set(ref.path, fields),
    }),
    fanOut: unused(),
    oauthFlow: unused(),
    oauthEngine: unused(),
    githubAppEngine: unused(),
    s3CredentialProbe: unused(),
    providerBalance: unused(),
    providerKeyProbe: {
      probe: async (templateId, key) => {
        probed.push(`${templateId}:${key}`);
        return outcome;
      },
    },
    oauthCallbackUrl: "https://example.com/callback",
    brandName: "Test",
    connectionLock: (_key, fn) => fn(),
    resolveKbShare: unused(),
  });
  return { svc, rows, secrets, probed };
}

const create = (svc: ReturnType<typeof makeService>["svc"]) =>
  svc.createFromTemplate({
    templateId: "ibm-litellm",
    name: "litellm",
    authKind: "header",
    value: "sk-wrong-instance",
  });

describe("provider key verification", () => {
  // TEST_SCENARIO: a refused IBM LiteLLM key is not stored, and the message points at the ETE instance whose keys work.
  it("refuses a key the provider rejects", async () => {
    const { svc, rows, secrets, probed } = makeService({
      ok: false,
      reason: "refused",
      detail: "HTTP 401",
    });
    await expect(create(svc)).rejects.toThrow(
      /two ETE LiteLLM instances.*ete-litellm\.ai-models\.vpc\.res\.ibm\.com\/ui\?page=api-keys/,
    );
    expect(probed).toEqual(["ibm-litellm:sk-wrong-instance"]);
    expect(rows.size).toBe(0);
    expect(secrets.size).toBe(0);
  });

  // TEST_SCENARIO: an unreachable provider says nothing about the key, so the save goes through.
  it("saves when the provider cannot be reached", async () => {
    const { svc, rows } = makeService({
      ok: false,
      reason: "unverified",
      detail: "fetch failed",
    });
    await create(svc);
    expect(rows.size).toBe(1);
  });

  // TEST_SCENARIO: rotating the key of an existing provider connection is checked the same way.
  it("refuses a rejected key on rotation", async () => {
    const accepted = makeService({ ok: true });
    const id = await create(accepted.svc);
    const refusing = makeService({
      ok: false,
      reason: "refused",
      detail: "HTTP 401",
    });
    refusing.rows.set(id, accepted.rows.get(id)!);
    await expect(
      refusing.svc.update(id, { value: "sk-other" }),
    ).rejects.toThrow(/refused this key/);
    expect(refusing.secrets.size).toBe(0);
  });
});
