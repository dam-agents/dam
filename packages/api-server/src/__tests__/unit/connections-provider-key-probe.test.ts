import { beforeEach, describe, expect, it } from "vitest";
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
 * work; a provider that cannot be reached does not block the save. The result
 * and its time are kept on the connection and listed with it, and a recheck
 * probes every stored provider key again, records the new result, and logs a
 * refused or unverified one; a template with no model-list check is left
 * unchecked. A Bedrock key is checked in the region its Connection serves.
 */

const logLines: string[] = [];
configureLogger({ level: "warn", write: (line) => logLines.push(line) });

function unused<T extends object>(fields: Partial<T> = {}): T {
  return new Proxy(fields, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected dependency: ${String(key)}`);
    },
  }) as T;
}

function makeService(
  outcome: ProviderKeyProbeOutcome,
  outcomes: Record<string, ProviderKeyProbeOutcome> = {},
) {
  const rows = new Map<string, Connection>();
  const secrets = new Map<string, Record<string, string>>();
  const probed: string[] = [];
  const regions: (string | undefined)[] = [];
  const svc = createConnectionsService({
    harnesses: { default: "claude-code", harnesses: [] },
    platformProviderEnabled: async () => false,
    platformProviderKey: null,
    isOwnedAgent: async () => true,
    ownerId: "owner",
    templates: createConnectionTemplateRegistry(buildCatalog()),
    repo: unused<ConnectionsRepository>({
      insert: async (c) => void rows.set(c.id, c),
      get: async (id) => rows.get(id) ?? null,
      listByOwner: async () => [...rows.values()],
      listByOwnerOldestFirst: async () => [...rows.values()],
      mergeInputs: async (id, patch) => {
        const row = rows.get(id);
        if (row) rows.set(id, { ...row, inputs: { ...row.inputs, ...patch } });
      },
    }),
    secretStore: unused<SecretStore>({
      storeId: "test",
      mintRef: (meta) => ({ storeId: "test", path: meta.purpose, field: "" }),
      put: async (ref, fields) => void secrets.set(ref.path, fields),
      putFields: async (ref, fields) => void secrets.set(ref.path, fields),
      getField: async (ref) => secrets.get(ref.path)?.["value"] ?? null,
    }),
    fanOut: unused(),
    oauthFlow: unused(),
    oauthEngine: unused(),
    githubAppEngine: unused(),
    s3CredentialProbe: unused(),
    providerBalance: unused(),
    credentialProbe: { probe: async () => ({ status: "passed" }) },
    providerKeyProbe: {
      probe: async (templateId, key, target) => {
        probed.push(`${templateId}:${key}`);
        regions.push(target?.region);
        return outcomes[templateId] ?? outcome;
      },
    },
    oauthCallbackUrl: "https://example.com/callback",
    brandName: "Test",
    connectionLock: (_key, fn) => fn(),
    resolveKbShare: unused(),
  });
  return { svc, rows, secrets, probed, regions };
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

describe("provider key recheck", () => {
  beforeEach(() => {
    logLines.length = 0;
  });

  const connect = (
    svc: ReturnType<typeof makeService>["svc"],
    templateId: string,
    value: string,
  ) =>
    svc.createFromTemplate({
      templateId,
      name: templateId,
      authKind: "header",
      value,
    });

  // TEST_SCENARIO: a key the provider accepts at save time is listed with an ok check and its time, so the row can say when it was last checked.
  it("records the save-time check on the listed connection", async () => {
    const { svc } = makeService({ ok: true });
    await create(svc);
    const [view] = await svc.listConnections();
    expect(view?.keyCheck).toMatchObject({ result: "ok" });
    expect(Date.parse(view!.keyCheck!.checkedAt)).not.toBeNaN();
  });

  // TEST_SCENARIO: each stored provider key is probed again with the stored value, and the result per connection is ok, refused with the HTTP detail, unverified with its detail, or null for a template with no model-list check; the new result replaces the stored one.
  it("probes every stored provider key and records each result", async () => {
    const saved = makeService(
      { ok: true },
      { bob: { ok: true, unchecked: true } },
    );
    const anthropic = await connect(saved.svc, "anthropic-oauth", "sk-ant-oat");
    const openai = await connect(saved.svc, "openai", "sk-openai");
    const litellm = await connect(saved.svc, "ibm-litellm", "sk-litellm");
    const bob = await connect(saved.svc, "bob", "bob-key");

    const later = makeService(
      { ok: true },
      {
        "anthropic-oauth": {
          ok: false,
          reason: "refused",
          detail: "HTTP 401",
        },
        "ibm-litellm": {
          ok: false,
          reason: "unverified",
          detail: "HTTP 503",
        },
        bob: { ok: true, unchecked: true },
      },
    );
    for (const [id, row] of saved.rows) later.rows.set(id, row);
    for (const [path, fields] of saved.secrets) later.secrets.set(path, fields);

    const results = await later.svc.recheckProviderKeys();
    const byId = new Map(results.map((r) => [r.connectionId, r.check]));

    expect(later.probed.sort()).toEqual([
      "anthropic-oauth:sk-ant-oat",
      "bob:bob-key",
      "ibm-litellm:sk-litellm",
      "openai:sk-openai",
    ]);
    expect(byId.get(anthropic)).toMatchObject({
      result: "refused",
      detail: "HTTP 401",
    });
    expect(byId.get(openai)).toMatchObject({ result: "ok" });
    expect(byId.get(litellm)).toMatchObject({
      result: "unverified",
      detail: "HTTP 503",
    });
    expect(byId.get(bob)).toBeNull();

    const views = new Map(
      (await later.svc.listConnections()).map((v) => [v.id, v.keyCheck]),
    );
    expect(views.get(anthropic)?.result).toBe("refused");
    expect(views.get(litellm)?.result).toBe("unverified");
    expect(views.get(openai)?.result).toBe("ok");
    expect(views.get(bob)).toBeUndefined();
  });

  // TEST_SCENARIO: a refused or unverified recheck writes the same security log line the save path writes, naming the connection and the reason.
  it("logs a refused or unverified recheck", async () => {
    const saved = makeService({ ok: true });
    const id = await create(saved.svc);
    const later = makeService({
      ok: false,
      reason: "refused",
      detail: "HTTP 401",
    });
    for (const [rowId, row] of saved.rows) later.rows.set(rowId, row);
    for (const [path, fields] of saved.secrets) later.secrets.set(path, fields);
    logLines.length = 0;

    await later.svc.recheckProviderKeys();

    const failures = logLines.filter((l) =>
      l.includes("connection.provider_key_probe_failed"),
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain(id);
    expect(failures[0]).toContain("refused");
  });

  // TEST_SCENARIO: a connection whose stored key is gone reads refused, since no request with it can succeed.
  it("reads a missing stored key as refused", async () => {
    const saved = makeService({ ok: true });
    const id = await create(saved.svc);
    saved.secrets.clear();
    saved.probed.length = 0;

    const [result] = await saved.svc.recheckProviderKeys();
    expect(result).toMatchObject({
      connectionId: id,
      check: { result: "refused", detail: "no key is stored" },
    });
    expect(saved.probed).toEqual([]);
  });

  // TEST_SCENARIO: a Bedrock key is probed in the region its Connection serves, at save time and on recheck alike.
  it("checks a Bedrock key in the connection's region", async () => {
    const saved = makeService({ ok: true });
    const id = await saved.svc.createFromTemplate({
      templateId: "bedrock",
      name: "bedrock",
      authKind: "header",
      value: "ABSK-key",
      configInputs: { region: "eu-central-1" },
    });
    expect(saved.probed).toEqual(["bedrock:ABSK-key"]);
    expect(saved.regions).toEqual(["eu-central-1"]);

    const [result] = await saved.svc.recheckProviderKeys();
    expect(result).toMatchObject({ connectionId: id, check: { result: "ok" } });
    expect(saved.regions).toEqual(["eu-central-1", "eu-central-1"]);
  });
});
