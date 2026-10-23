import { describe, expect, it } from "vitest";
import type { Connection } from "api-server-api";

import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import { createConnectionTemplateRegistry } from "../../modules/connections/domain/connection-template.js";
import {
  CredentialCheckNotPassed,
  type CredentialProbeOutcome,
  type CredentialProbeTarget,
} from "../../modules/connections/domain/credential-check.js";
import type { ConnectionsRepository } from "../../modules/connections/infrastructure/connections-repository.js";
import { createConnectionsService } from "../../modules/connections/services/connections-service.js";
import type { SecretStore } from "../../modules/secret-store/index.js";
import { configureLogger } from "../../core/logger.js";
import { TEST_CLUSTER_CERT as CA_PEM } from "../helpers/test-cluster-cert.js";

/**
 * TEST_OVERVIEW: a GitHub personal access token is checked when it is saved,
 * on create and on rotation, and the result is kept on the Connection and
 * listed with it, so a token saved after a failed check does not look like a
 * healthy one. The secret-entry page asks to hold a token that does not pass:
 * nothing is stored and the caller gets the check back. Without that ask the
 * token is saved with its result. A stored token can be checked again, which
 * replaces the result; a Connection whose template names no check has none.
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

function makeService(initial: CredentialProbeOutcome) {
  const rows = new Map<string, Connection>();
  const secrets = new Map<string, Record<string, string>>();
  const probed: (CredentialProbeTarget & { value: string })[] = [];
  const answer = { outcome: initial };
  const svc = createConnectionsService({
    harnesses: { default: "claude-code", harnesses: [] },
    isOwnedAgent: async () => true,
    ownerId: "owner",
    templates: createConnectionTemplateRegistry(buildCatalog()),
    repo: unused<ConnectionsRepository>({
      insert: async (c) => void rows.set(c.id, c),
      get: async (id) => rows.get(id) ?? null,
      listByOwner: async () => [...rows.values()],
      listByOwnerOldestFirst: async () => [...rows.values()],
      listAgentsForConnection: async () => [],
      mergeInputs: async (id, patch) => {
        const row = rows.get(id);
        if (row) rows.set(id, { ...row, inputs: { ...row.inputs, ...patch } });
      },
    }),
    secretStore: unused<SecretStore>({
      storeId: "test",
      mintRef: (meta) => ({ storeId: "test", path: meta.purpose, field: "" }),
      put: async (ref, fields) => void secrets.set(ref.path, fields),
      putFields: async (ref, fields) =>
        void secrets.set(ref.path, { ...secrets.get(ref.path), ...fields }),
      get: async (ref) => secrets.get(ref.path) ?? null,
      getField: async (ref) => secrets.get(ref.path)?.["value"] ?? null,
    }),
    fanOut: unused(),
    oauthFlow: unused(),
    oauthEngine: unused(),
    githubAppEngine: unused(),
    s3CredentialProbe: unused(),
    providerBalance: unused(),
    providerKeyProbe: {
      probe: async (templateId) =>
        templateId === "openai" ? { ok: true } : { ok: true, unchecked: true },
    },
    credentialProbe: {
      probe: async (_kind, target, value) => {
        probed.push({ ...target, value });
        return answer.outcome;
      },
    },
    oauthCallbackUrl: "https://example.com/callback",
    brandName: "Test",
    connectionLock: (_key, fn) => fn(),
    resolveKbShare: unused(),
  });
  return { svc, rows, secrets, probed, answer };
}

const githubPat = (value = "ghp_wrong") =>
  ({
    templateId: "github-pat",
    name: "github-pat",
    authKind: "header",
    value,
  }) as const;

const refused: CredentialProbeOutcome = {
  status: "failed",
  reason: "GitHub refused the token (Bad credentials)",
};

describe("credential check on save", () => {
  // TEST_SCENARIO: the token GitHub accepts is saved, and the listed connection carries the passed check with the account and the time, so the CLI and the UI can name the account.
  it("lists the passed check with the connection", async () => {
    const { svc, probed } = makeService({
      status: "passed",
      account: "octocat",
    });
    await svc.createFromTemplate(githubPat("ghp_good"));
    const [view] = await svc.listConnections();
    expect(probed).toEqual([{ host: "github.com", value: "ghp_good" }]);
    expect(view?.status).toBe("active");
    expect(view?.check).toMatchObject({ status: "passed", account: "octocat" });
    expect(Date.parse(view!.check!.at)).not.toBeNaN();
  });

  // TEST_SCENARIO: the secret-entry page asks to hold a token that fails; nothing is stored, and the error carries the check so the page can show the reason and offer Save anyway.
  it("holds a failing token when asked", async () => {
    const { svc, rows, secrets } = makeService(refused);
    const err = await svc
      .createFromTemplate(githubPat(), { holdUnlessPassed: true })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CredentialCheckNotPassed);
    expect((err as CredentialCheckNotPassed).check).toMatchObject(refused);
    expect(rows.size).toBe(0);
    expect(secrets.size).toBe(0);
  });

  // TEST_SCENARIO: a GitHub outage holds the token the same way, since the page warns when the check could not run too.
  it("holds an unchecked token when asked", async () => {
    const { svc, rows } = makeService({
      status: "unchecked",
      reason: "GitHub answered HTTP 502, which says nothing about the token",
    });
    await expect(
      svc.createFromTemplate(githubPat(), { holdUnlessPassed: true }),
    ).rejects.toBeInstanceOf(CredentialCheckNotPassed);
    expect(rows.size).toBe(0);
  });

  // TEST_SCENARIO: saved anyway, the token is stored with its failed check, so the listing shows it failed and the reason; a direct create without the ask behaves the same, the user is warned and never blocked.
  it("saves a failing token with its result when not held", async () => {
    const { svc } = makeService(refused);
    await svc.createFromTemplate(githubPat());
    const [view] = await svc.listConnections();
    expect(view?.check).toMatchObject(refused);
  });

  // TEST_SCENARIO: a GitHub Enterprise token is checked against its own host, the one its connection names.
  it("checks a GitHub Enterprise token on its host", async () => {
    const { svc, probed } = makeService({ status: "passed", account: "me" });
    await svc.createFromTemplate({
      templateId: "github-enterprise-pat",
      name: "ghe",
      authKind: "header",
      host: "ghe.acme.com",
      value: "ghp_ghe",
    });
    expect(probed).toEqual([{ host: "ghe.acme.com", value: "ghp_ghe" }]);
  });

  // TEST_SCENARIO: a rotation is checked too: held, the working token stays in place; saved, the new result replaces the old one.
  it("checks a rotated token", async () => {
    const w = makeService({ status: "passed", account: "octocat" });
    const id = await w.svc.createFromTemplate(githubPat("ghp_good"));
    const stored = new Map(w.secrets);

    w.answer.outcome = refused;
    await expect(
      w.svc.update(id, { value: "ghp_bad" }, { holdUnlessPassed: true }),
    ).rejects.toBeInstanceOf(CredentialCheckNotPassed);
    expect(w.secrets).toEqual(stored);
    expect((await w.svc.getConnection(id))?.check?.status).toBe("passed");

    await w.svc.update(id, { value: "ghp_bad" });
    expect((await w.svc.getConnection(id))?.check).toMatchObject(refused);
  });

  // TEST_SCENARIO: a template with no check, such as a custom header, is saved with no check at all, never one that reads as failed.
  it("leaves a template with no check unchecked", async () => {
    const { svc, probed } = makeService(refused);
    await svc.createFromTemplate(
      {
        templateId: "custom-header",
        name: "my-api",
        authKind: "header",
        host: "api.example.com",
        headerName: "X-API-Key",
        value: "k",
      },
      { holdUnlessPassed: true },
    );
    const [view] = await svc.listConnections();
    expect(probed).toEqual([]);
    expect(view?.check).toBeUndefined();
  });
});

describe("Kubernetes token check", () => {
  const kubernetes = (caData?: string) =>
    ({
      templateId: "kubernetes",
      name: "prod",
      authKind: "header",
      host: "https://api.prod.example:6443",
      value: "sa-token",
      ...(caData ? { caData } : {}),
    }) as const;

  // TEST_SCENARIO: a service-account token is checked on the API server the connection names, port included, and with the CA the user gave, so a wrong CA fails the way kubectl would; the check names the identity the token acts as.
  it("checks the token on its cluster with the given CA", async () => {
    const { svc, probed } = makeService({
      status: "passed",
      account: "system:serviceaccount:ops:deployer",
    });
    await svc.createFromTemplate(kubernetes(CA_PEM));
    const [view] = await svc.listConnections();
    expect(probed).toEqual([
      {
        host: "api.prod.example",
        port: 6443,
        caPem: CA_PEM.trim(),
        value: "sa-token",
      },
    ]);
    expect(view?.check).toMatchObject({
      status: "passed",
      account: "system:serviceaccount:ops:deployer",
    });
  });

  // TEST_SCENARIO: a cluster with a publicly trusted certificate has no CA, and the check trusts the public roots alone.
  it("checks a publicly trusted cluster without a CA", async () => {
    const { svc, probed } = makeService({ status: "passed" });
    await svc.createFromTemplate(kubernetes());
    expect(probed).toEqual([
      { host: "api.prod.example", port: 6443, value: "sa-token" },
    ]);
  });

  // TEST_SCENARIO: a rotated token and a check on demand both reuse the CA stored at create, since neither is given it again.
  it("keeps the stored CA for a rotation and a check on demand", async () => {
    const w = makeService({ status: "passed" });
    const id = await w.svc.createFromTemplate(kubernetes(CA_PEM));
    await w.svc.update(id, { value: "sa-token-2" });
    await w.svc.checkCredential(id);
    expect(w.probed.slice(1)).toEqual([
      expect.objectContaining({ caPem: CA_PEM.trim(), value: "sa-token-2" }),
      expect.objectContaining({ caPem: CA_PEM.trim(), value: "sa-token-2" }),
    ]);
  });
});

describe("credential check on demand", () => {
  // TEST_SCENARIO: a token that worked when saved is revoked later; checking the stored token again probes it and records the failure on the connection.
  it("checks a stored token again and records the result", async () => {
    const w = makeService({ status: "passed", account: "octocat" });
    const id = await w.svc.createFromTemplate(githubPat("ghp_good"));
    w.answer.outcome = refused;
    await expect(w.svc.checkCredential(id)).resolves.toMatchObject(refused);
    expect(w.probed.at(-1)).toEqual({ host: "github.com", value: "ghp_good" });
    expect((await w.svc.getConnection(id))?.check).toMatchObject(refused);
  });

  // TEST_SCENARIO: a provider key is checked again with the provider key check, and its result reads in the same terms.
  it("checks a model provider key with its own check", async () => {
    const w = makeService(refused);
    const id = await w.svc.createFromTemplate({
      templateId: "openai",
      name: "openai",
      authKind: "header",
      value: "sk-openai",
    });
    await expect(w.svc.checkCredential(id)).resolves.toMatchObject({
      status: "passed",
    });
    expect(w.probed).toEqual([]);
  });

  // TEST_SCENARIO: a connection whose template names no check has nothing to check, and an unknown id is not found.
  it("returns null without a check, and refuses an unknown id", async () => {
    const w = makeService(refused);
    const id = await w.svc.createFromTemplate({
      templateId: "custom-header",
      name: "my-api",
      authKind: "header",
      host: "api.example.com",
      headerName: "X-API-Key",
      value: "k",
    });
    await expect(w.svc.checkCredential(id)).resolves.toBeNull();
    await expect(w.svc.checkCredential("conn-missing")).rejects.toThrow(
      /NOT_FOUND/,
    );
  });
});
